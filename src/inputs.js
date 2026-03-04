import { parseBooleanLike } from "./utils.js";

function readInput(name, fallback = "") {
  return process.env[`INPUT_${name.toUpperCase()}`] || fallback;
}

function getInputs() {
  const modeInput = readInput("mode", "changed");
  return {
    notionToken: readInput("notion_token", ""),
    githubToken: readInput("github_token", process.env.GITHUB_TOKEN || ""),
    mode: modeInput.toLowerCase() === "full" ? "full" : "changed",
    pathFilter: readInput("path_filter", "**/.notion.txt"),
    assetsDir: readInput("assets_dir", "notion-assets"),
    commit: parseBooleanLike(readInput("commit", "true"), true),
    dryRun: parseBooleanLike(readInput("dry_run", "false"), false),
    commitUserName: readInput("commit_user_name", "github-actions[bot]"),
    commitUserEmail: readInput("commit_user_email", "41898282+github-actions[bot]@users.noreply.github.com"),
  };
}

export { getInputs };
