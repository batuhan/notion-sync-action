import fs from "node:fs/promises";
import path from "node:path";

function boolFromInput(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function safeFileName(value) {
  return value
    .normalize("NFKD")
    .replace(/[\/\\]/g, " ")
    .replace(/[\s:]+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120) || "notion-page";
}

function encodeOutputValue(value) {
  return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

async function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  await fs.appendFile(outputPath, `${name}=${encodeOutputValue(value)}\n`);
}

function parseBooleanLike(value, fallback = false) {
  return boolFromInput(value, fallback);
}

function normalizeNotionId(input) {
  const clean = String(input || "").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length !== 32) {
    return null;
  }
  const lower = clean.toLowerCase();
  return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
}

function extractNotionId(raw) {
  const direct = normalizeNotionId(raw);
  if (direct) {
    return direct;
  }

  try {
    const url = new URL(raw);
    const directInQuery = url.searchParams.get("p") || url.searchParams.get("d") || url.searchParams.get("v");
    if (directInQuery) {
      const directFromQuery = normalizeNotionId(directInQuery);
      if (directFromQuery) {
        return directFromQuery;
      }
    }

    const match = raw.match(/[0-9a-fA-F]{32}/);
    if (match) {
      return normalizeNotionId(match[0]);
    }
  } catch {
    // Not a URL
  }

  const fallback = String(raw || "").match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return fallback ? fallback[0].toLowerCase() : null;
}

function parseManifestLines(content) {
  const lines = String(content || "").split(/\r?\n/);
  return lines
    .map((line, index) => ({
      raw: line,
      line: index + 1,
      trimmed: line.trim(),
    }))
    .filter((entry) => {
      if (!entry.trimmed) {
        return false;
      }
      if (entry.trimmed.startsWith("#")) {
        return false;
      }
      return true;
    })
    .map((entry) => ({
      raw: entry.trimmed,
      line: entry.line,
    }));
}

async function listNotionManifests(root, filter = "**/.notion.txt") {
  const out = [];
  const stack = [root];

  const ignoredDirs = new Set([
    ".git",
    "node_modules",
    ".next",
    "dist",
    "coverage",
    "tmp",
    ".idea",
    ".vscode",
  ]);

  const matches = (p) => {
    if (!filter || filter === "**/.notion.txt") {
      return path.basename(p) === ".notion.txt";
    }
    const normalized = p.split(path.sep).join("/");
    return normalized.endsWith(filter.replace("**/", "").replace("**", ""));
  };

  while (stack.length > 0) {
    const current = stack.pop();
    const dirents = await fs.readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (ignoredDirs.has(dirent.name)) {
          continue;
        }
        if (dirent.name.startsWith(".")) {
          if (dirent.name === ".notion" || dirent.name === ".notion-assets") {
            continue;
          }
        }
        stack.push(full);
        continue;
      }

      if (dirent.isFile() && matches(full)) {
        out.push(full);
      }
    }
  }

  return out.sort();
}

async function listExistingNotionPagesInDir(directory) {
  const result = new Map();
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);

  for (const dirent of entries) {
    if (!dirent.isFile() || !dirent.name.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(directory, dirent.name);
    try {
      const content = await fs.readFile(filePath, "utf8");
      if (!content.startsWith("---\n")) {
        continue;
      }
      const end = content.indexOf("\n---", 4);
      if (end <= 0) {
        continue;
      }
      const frontmatter = content.slice(4, end);
      const idMatch = frontmatter.match(/notion_id:\s*([^\n]+)/);
      if (!idMatch) {
        continue;
      }
      const notionId = idMatch[1].trim().replace(/^['\"]|['\"]$/g, "");
      if (!notionId) {
        continue;
      }
      if (!result.has(notionId)) {
        result.set(notionId, filePath);
      }
    } catch {
      // Ignore malformed files.
    }
  }

  return result;
}

function uniqueSlug(base, used) {
  const clean = safeFileName(base);
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }

  let index = 2;
  while (used.has(`${clean}-${index}`)) {
    index += 1;
  }
  const next = `${clean}-${index}`;
  used.add(next);
  return next;
}

function slugFromTitle(title) {
  return safeFileName(title);
}

function deduplicateList(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function readEventFile() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return null;
  }
  return fs.readFile(eventPath, "utf8").then((content) => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  });
}

export {
  boolFromInput,
  parseBooleanLike,
  safeFileName,
  writeOutput,
  normalizeNotionId,
  extractNotionId,
  parseManifestLines,
  listNotionManifests,
  listExistingNotionPagesInDir,
  uniqueSlug,
  slugFromTitle,
  deduplicateList,
  readEventFile,
};
