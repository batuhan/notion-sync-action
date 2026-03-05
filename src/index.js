import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { NotionToMarkdown } from "notion-to-md";
import { getInputs } from "./inputs.js";
import {
  parseManifestLines,
  extractNotionId,
  listNotionManifests,
  listExistingNotionPagesInDir,
  uniqueSlug,
  slugFromTitle,
  deduplicateList,
  readEventFile,
  writeOutput,
} from "./utils.js";
import { NotionSyncClient } from "./notionClient.js";
import {
  isRepoClean,
  configureIdentity,
  stageFiles,
  commit,
  setAuthenticatedRemote,
  push,
  listChangedFiles,
  listFilesChangedBetween,
} from "./git.js";

function collectChangedManifestsFromEvent(event = {}) {
  const candidates = [];
  const commits = Array.isArray(event.commits) ? event.commits : [];
  for (const commit of commits) {
    for (const key of ["added", "modified", "removed"]) {
      for (const file of commit[key] || []) {
        if (typeof file === "string" && file.endsWith(".notion.txt")) {
          candidates.push(file);
        }
      }
    }
  }

  if (candidates.length > 0) {
    return deduplicateList(candidates);
  }

  if (event.head_commit) {
    const combined = [];
    if (Array.isArray(event.head_commit.added)) combined.push(...event.head_commit.added);
    if (Array.isArray(event.head_commit.removed)) combined.push(...event.head_commit.removed);
    if (Array.isArray(event.head_commit.modified)) combined.push(...event.head_commit.modified);
    return deduplicateList(combined.filter((file) => typeof file === "string" && file.endsWith(".notion.txt")));
  }

  return [];
}

function buildCandidates(entries) {
  const used = new Set();
  const deduped = [];

  for (const entry of entries) {
    if (!entry || !entry.id) {
      continue;
    }

    const key = `${entry.id}:${entry.sourceFile}`;
    if (used.has(key)) {
      continue;
    }

    used.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function collectChangedManifestsFromGit(event = {}) {
  const refs = [];

  if (event.before && event.after) {
    refs.push([event.before, event.after]);
  }

  if (event.pull_request?.base?.sha && event.pull_request?.head?.sha) {
    refs.push([event.pull_request.base.sha, event.pull_request.head.sha]);
  }

  for (const [baseRef, headRef] of refs) {
    const changed = listFilesChangedBetween(baseRef, headRef).filter((file) => file.endsWith(".notion.txt"));
    if (changed.length > 0) {
      return deduplicateList(changed);
    }
  }

  return [];
}

async function resolveManifests(inputs) {
  if (!process.env.GITHUB_EVENT_PATH) {
    return inputs.mode === "full"
      ? listNotionManifests(process.cwd(), inputs.pathFilter)
      : [];
  }

  if (!process.env.GITHUB_EVENT_PATH || inputs.mode !== "changed") {
    return listNotionManifests(process.cwd(), inputs.pathFilter);
  }

  if (process.env.GITHUB_EVENT_NAME === "schedule") {
    return listNotionManifests(process.cwd(), inputs.pathFilter);
  }

  const event = await readEventFile();
  if (!event) {
    return [];
  }

  const changed = collectChangedManifestsFromEvent(event);
  if (changed.length > 0) {
    return deduplicateList(changed.map((file) => path.resolve(process.cwd(), file)));
  }

  const changedFromGit = collectChangedManifestsFromGit(event);
  if (changedFromGit.length > 0) {
    return deduplicateList(changedFromGit.map((file) => path.resolve(process.cwd(), file)));
  }

  return [];
}

async function readManifest(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parseManifestLines(content);
  } catch {
    return [];
  }
}

function toMeta(page, sourceFile, sourceLine) {
  const title = NotionSyncClient.extractPageTitle(page);
  return {
    notion_id: page.id,
    notion_url: page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`,
    title,
    source_file: sourceFile,
    source_line: sourceLine,
    last_edited_time: page.last_edited_time || "",
    notion_parent: page.parent || null,
    fetched_at: new Date().toISOString(),
  };
}

async function getDirectoryState(directory, directoryState) {
  const cached = directoryState.get(directory);
  if (cached) {
    return cached;
  }

  await fs.mkdir(directory, { recursive: true });
  const existingById = await listExistingNotionPagesInDir(directory);
  const usedNames = new Set(
    Array.from(existingById.values()).map((item) => path.basename(item).replace(/\.md$/i, "")),
  );

  const state = { existingById, usedNames };
  directoryState.set(directory, state);
  return state;
}

function collectChildPageBlocks(blocks = []) {
  const childPages = [];

  for (const block of blocks) {
    if (block.type === "child_page") {
      childPages.push(block);
      continue;
    }

    if (Array.isArray(block.children) && block.children.length > 0) {
      childPages.push(...collectChildPageBlocks(block.children));
    }
  }

  return childPages;
}

function markdownFromBlocks(n2m, blocks) {
  const markdownObject = n2m.toMarkdownString(blocks);
  const parent = typeof markdownObject.parent === "string" ? markdownObject.parent : "";
  return parent.trim() ? `${parent.trim()}\n` : "";
}

function frontmatterFromMeta(meta) {
  const yamlBody = yaml.dump(meta, { noRefs: true, lineWidth: 2000 });
  return `---\n${yamlBody}---`;
}

async function writePageMarkdown({
  directory,
  page,
  markdown,
  meta,
  existingById,
  usedNames,
}) {
  await fs.mkdir(directory, { recursive: true });
  const desiredBase = slugFromTitle(meta.title || "notion-page");
  const targetBase = uniqueSlug(desiredBase, usedNames);
  const targetPath = path.join(directory, `${targetBase}.md`);

  const existingPath = existingById.get(page.id);
  if (existingPath && existingPath !== targetPath) {
    try {
      await fs.rename(existingPath, targetPath);
    } catch {
      // If rename fails, keep any existing target and overwrite content.
    }
    existingById.set(page.id, targetPath);
  }

  const payload = `${frontmatterFromMeta(meta)}\n\n${markdown}`;
  await fs.writeFile(targetPath, payload, "utf8");
  return targetPath;
}

async function syncPageTree({
  directory,
  pageId,
  blocks,
  notionClient,
  n2m,
  directoryState,
  stats,
  sourceFile,
  sourceLine,
  sourceText,
}) {
  const page = await notionClient.getPageById(pageId);
  const markdown = markdownFromBlocks(n2m, blocks);
  const meta = toMeta(page, sourceFile, sourceLine);
  meta.source_ref = sourceText;

  const { existingById, usedNames } = await getDirectoryState(directory, directoryState);
  const writtenPath = await writePageMarkdown({
    directory,
    page,
    markdown,
    meta,
    existingById,
    usedNames,
  });

  existingById.set(page.id, writtenPath);
  usedNames.add(path.basename(writtenPath).replace(/\.md$/i, ""));
  stats.pages += 1;
  console.log(`Synced ${meta.title} -> ${writtenPath}`);

  const childPageBlocks = collectChildPageBlocks(blocks);
  if (childPageBlocks.length === 0) {
    return [writtenPath];
  }

  const childDirectory = path.join(directory, path.basename(writtenPath, ".md"));
  const filesWritten = [writtenPath];

  for (const childPageBlock of childPageBlocks) {
    if (!childPageBlock.blockId || !Array.isArray(childPageBlock.children)) {
      continue;
    }

    const childFiles = await syncPageTree({
      directory: childDirectory,
      pageId: childPageBlock.blockId,
      blocks: childPageBlock.children,
      notionClient,
      n2m,
      directoryState,
      stats,
      sourceFile,
      sourceLine,
      sourceText,
    });
    filesWritten.push(...childFiles);
  }

  return filesWritten;
}

async function syncManifest(filePath, notionClient, inputs, stats) {
  const directory = path.dirname(filePath);
  const n2m = new NotionToMarkdown({
    notionClient: notionClient.client,
    config: {
      separateChildPage: true,
      parseChildPages: true,
    },
  });
  const directoryState = new Map();

  const lines = await readManifest(filePath);
  const requested = [];

  for (const line of lines) {
    const notionId = extractNotionId(line.raw);
    if (!notionId) {
      console.warn(`Skipping invalid line in ${filePath}:${line.line}: ${line.raw}`);
      continue;
    }

    requested.push({
      id: notionId,
      sourceFile: filePath,
      sourceLine: line.line,
      sourceText: line.raw,
    });
  }

  const candidates = buildCandidates(requested);
  const targets = [];

  for (const candidate of candidates) {
    try {
      const resolved = await notionClient.resolveObjectById(candidate.id);
      if (resolved.kind === "database") {
        const pages = await notionClient.getDatabasePages(candidate.id);
        for (const page of pages) {
          if (page.object !== "page") {
            continue;
          }
          targets.push({
            pageId: page.id,
            sourceFile: filePath,
            sourceLine: candidate.sourceLine,
            sourceText: candidate.sourceText,
          });
        }
        continue;
      }

      targets.push({
        pageId: candidate.id,
        sourceFile: filePath,
        sourceLine: candidate.sourceLine,
        sourceText: candidate.sourceText,
      });
    } catch (error) {
      console.error(`Skipping ${candidate.id}: ${error.message}`);
    }
  }

  const filesWritten = [];

  for (const target of targets) {
    const pageBlocks = await n2m.pageToMarkdown(target.pageId);
    const written = await syncPageTree({
      directory,
      pageId: target.pageId,
      blocks: pageBlocks,
      notionClient,
      n2m,
      directoryState,
      stats,
      sourceFile: target.sourceFile,
      sourceLine: target.sourceLine,
      sourceText: target.sourceText,
    });
    filesWritten.push(...written);
  }

  return {
    filesWritten,
    assetsDownloaded: 0,
  };
}

function parseInputs() {
  return getInputs();
}

async function commitChanges(inputs, changedFiles) {
  if (!inputs.commit || inputs.dryRun) {
    return;
  }

  if (!inputs.githubToken) {
    throw new Error("github_token is required when commit is enabled");
  }

  if (!changedFiles.length) {
    return;
  }

  configureIdentity(inputs.commitUserName, inputs.commitUserEmail);
  setAuthenticatedRemote(inputs.githubToken);
  stageFiles(changedFiles);

  if (isRepoClean()) {
    return;
  }

  commit("chore(notion): sync markdown from notion");
  push();
}

async function main() {
  const inputs = parseInputs();
  if (!inputs.notionToken) {
    throw new Error("notion_token is required");
  }

  const effectiveMode = process.env.GITHUB_EVENT_NAME === "schedule" ? "full" : inputs.mode;
  const manifests = await resolveManifests({ ...inputs, mode: effectiveMode });
  if (!manifests.length) {
    console.log("No .notion.txt manifests found.");
    await writeOutput("synced_pages", 0);
    await writeOutput("synced_assets", 0);
    await writeOutput("changed_files", "");
    return;
  }

  const notionClient = new NotionSyncClient(inputs.notionToken);
  const result = {
    pages: 0,
    assets: 0,
    filesWritten: [],
  };

  for (const manifest of manifests) {
    const output = await syncManifest(manifest, notionClient, inputs, result);
    result.assets += output.assetsDownloaded;
    result.filesWritten.push(...output.filesWritten);
  }

  const changedFiles = deduplicateList(listChangedFiles());

  if (inputs.dryRun) {
    console.log(`Dry run complete. Would write ${changedFiles.length} files.`);
  } else {
    await commitChanges(inputs, changedFiles);
  }

  await writeOutput("synced_pages", result.pages);
  await writeOutput("synced_assets", result.assets);
  await writeOutput("changed_files", result.filesWritten.join(","));

  console.log(`Synced ${result.pages} page(s), downloaded ${result.assets} asset(s).`);
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});
