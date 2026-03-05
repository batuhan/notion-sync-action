import { execSync } from "node:child_process";

function run(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function isRepoClean() {
  const status = run("git status --porcelain");
  return status.length === 0;
}

function configureIdentity(name, email) {
  run(`git config user.name ${JSON.stringify(name)}`);
  run(`git config user.email ${JSON.stringify(email)}`);
}

function stageFiles(patterns = []) {
  if (!patterns.length) {
    return;
  }
  const escaped = patterns.map((pattern) => `"${pattern}"`).join(" ");
  run(`git add -- ${escaped}`);
}

function commit(message) {
  run(`git commit -m ${JSON.stringify(message)}`);
}

function getRepository() {
  return process.env.GITHUB_REPOSITORY || run("git rev-parse --show-toplevel");
}

function getRefName() {
  return process.env.GITHUB_REF_NAME || "main";
}

function setAuthenticatedRemote(token) {
  const repository = getRepository();
  if (!repository) {
    return;
  }
  run(`git remote set-url origin https://x-access-token:${token}@github.com/${repository}.git`);
}

function push(refName) {
  const targetRef = refName || getRefName();
  run(`git push origin HEAD:${targetRef}`);
}

function listChangedFiles() {
  const status = run("git status --porcelain");
  return status
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const entry = line.slice(3).trim();
      const arrow = entry.indexOf(" -> ");
      return arrow >= 0 ? entry.slice(arrow + 4) : entry;
    });
}

function listFilesChangedBetween(baseRef, headRef) {
  if (!baseRef || !headRef) {
    return [];
  }

  try {
    const output = run(`git diff --name-only ${JSON.stringify(baseRef)} ${JSON.stringify(headRef)}`);
    if (!output) {
      return [];
    }

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export {
  isRepoClean,
  configureIdentity,
  stageFiles,
  commit,
  setAuthenticatedRemote,
  push,
  listChangedFiles,
  listFilesChangedBetween,
};
