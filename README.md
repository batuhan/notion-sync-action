# Notion Markdown Sync Action

Sync Notion pages and databases to Markdown using `.notion.txt` files in your repo.

- One `.notion.txt` file per folder, e.g. `docs/.notion.txt`.
- One line = one Notion page/database URL or ID.
- Each page is written as `Page_Name.md` in the same folder.
- Downloaded images/files are placed in sibling `notion-assets/` by default.
- Frontmatter is added so renames won’t lose history (`notion_id` is stable).

## Inputs

- `notion_token` (required): Notion integration token.
- `github_token` (required): usually `${{ github.token }}`.
- `mode`: `changed` (default) or `full`.
- `path_filter`: glob for manifests, default `**/.notion.txt`.
- `assets_dir`: default `notion-assets`.
- `commit`: `true`/`false` (default `true`).
- `dry_run`: `true`/`false` (default `false`).
- `commit_user_name`, `commit_user_email`: git identity.

## Outputs

- `synced_pages`: number of pages written.
- `synced_assets`: number of downloaded assets.
- `changed_files`: comma-separated markdown paths.

## Example `.notion.txt`

```text
# docs
https://www.notion.so/your-page-id-or-url
https://www.notion.so/your-database-id-or-url
```

You can place files anywhere:

```text
docs/.notion.txt
docs/desktop-app/.notion.txt
docs/desktop-app/backend/.notion.txt
```

## Workflow: run on branch pushes/PRs when `.notion.txt` changes

```yaml
name: notion-sync

on:
  push:
    branches:
      - main
      - develop
      - 'release/**'
    paths:
      - '**/.notion.txt'
  pull_request:
    branches:
      - main
      - develop
      - 'release/**'
    paths:
      - '**/.notion.txt'
  schedule:
    - cron: '0 */6 * * *'

permissions:
  contents: write

jobs:
  notion-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Sync Notion markdown
        uses: batuhan/notion-sync-action@main
        with:
          notion_token: ${{ secrets.NOTION_TOKEN }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          mode: changed
          commit: true
```

## Notes

- `mode: changed` only processes changed `.notion.txt` manifests.
- `schedule` runs a full sync automatically.
- `mode: full` can be forced when needed (e.g. one-off backfill).
