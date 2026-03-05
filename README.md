# Notion Markdown Sync

Sync Notion pages and databases into Markdown files in your repository.

## What it does

- Reads `.notion.txt` manifest files in your repo
- Fetches the referenced Notion pages or databases
- Writes Markdown files next to each manifest
- Preserves stable `notion_id` frontmatter so renames keep history
- Can commit generated changes back to the repo

## Quick start

Create a `.notion.txt` file:

```text
docs/.notion.txt
```

```text
https://www.notion.so/your-page-or-database-url
```

Add the action to your workflow:

```yaml
name: notion-sync

on:
  push:
    paths:
      - '**/.notion.txt'
  pull_request:
    paths:
      - '**/.notion.txt'
  schedule:
    - cron: '0 */6 * * *'

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: batuhan/notion-sync-action@v1
        with:
          notion_token: ${{ secrets.NOTION_TOKEN }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Manifest format

One `.notion.txt` file per directory. Each non-empty line is a Notion page or database URL/ID.

```text
# comments are ignored
https://www.notion.so/page-1
https://www.notion.so/database-1
```

Example:

```text
docs/.notion.txt
docs/guides/.notion.txt
docs/api/.notion.txt
```

## Output

For `docs/.notion.txt`, the action writes Markdown into `docs/`.

```text
docs/.notion.txt
docs/Getting-Started.md
docs/Getting-Started/Installation.md
docs/Getting-Started/Configuration.md
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `notion_token` | Yes | - | Notion integration token with read access |
| `github_token` | No | `${{ github.token }}` | Token used when committing changes |
| `mode` | No | `changed` | `changed` to process changed manifests, `full` to process all manifests |
| `path_filter` | No | `**/.notion.txt` | Manifest discovery glob |
| `commit` | No | `true` | Commit generated changes back to the repo |
| `dry_run` | No | `false` | Run without writing or committing |
| `commit_user_name` | No | `github-actions[bot]` | Commit author name |
| `commit_user_email` | No | `41898282+github-actions[bot]@users.noreply.github.com` | Commit author email |
| `assets_dir` | No | `notion-assets` | Reserved for future asset handling (currently unused) |

## Outputs

| Output | Description |
| --- | --- |
| `synced_pages` | Number of pages written |
| `synced_assets` | Number of assets downloaded (currently `0`) |
| `changed_files` | Comma-separated list of Markdown files written |

## Notes

- `mode: changed` is intended for push and pull request runs.
- Scheduled runs effectively sync everything.
- Set `commit: false` if you only want generated files during the workflow run.
