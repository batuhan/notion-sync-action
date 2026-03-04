# Notion Markdown Sync Action

This action syncs `.notion.txt` manifests to markdown files in the same directory.

- every `.notion.txt` line is interpreted as a Notion page or database reference
- database references expand to their pages
- markdown output is written as `Page_Name.md` in the manifest directory
- downloaded files/images are written to a sibling `notion-assets` directory (configurable)
- title changes are handled by using frontmatter `notion_id` for stable identity
- normal pushes only process changed `.notion.txt` files
- scheduled runs process all manifests

## Inputs

- `notion_token` (required): Notion integration token.
- `github_token` (required): usually `${{ github.token }}`.
- `mode` (`changed` | `full`, default `changed`):
  - `changed`: discover changed `.notion.txt` files from event payload.
  - `full`: discover all `.notion.txt` files.
- `path_filter` (default `**/.notion.txt`): manifest glob.
- `assets_dir` (default `notion-assets`): sibling asset directory name.
- `commit` (default `true`): push results.
- `dry_run` (default `false`): parse & render without writing.
- `commit_user_name` / `commit_user_email`: git identity.

## Outputs

- `synced_pages`: number of pages converted.
- `synced_assets`: number of downloaded assets.
- `changed_files`: comma separated markdown files written.

## Frontmatter

Every generated markdown file contains at least:

- `notion_id`
- `notion_url`
- `title`
- `source_file`
- `source_line`
- `last_edited_time`
- `notion_parent`
- `fetched_at`

## Example usage

Create `.notion.txt` files in folders you want exported:

```text
docs/.notion.txt
docs/desktop-app/.notion.txt
docs/desktop-app/backend/.notion.txt
```

### Add this workflow to consumer repositories

```yaml
name: notion-sync
on:
  push:
    paths:
      - "**/.notion.txt"
  schedule:
    - cron: "0 */6 * * *"

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
      - name: Sync Notion content to markdown
        uses: your-org/notion-sync-action@main
        with:
          notion_token: ${{ secrets.NOTION_TOKEN }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          path_filter: "**/.notion.txt"
          mode: changed
          commit: true
```

Notes:
- On `schedule`, the action runs a full sync automatically.
- On push/pull request, only changed `.notion.txt` files are processed.

## Notes

- This action is designed to be lightweight and avoids deleting existing files automatically when references disappear.
- If a line cannot be parsed as a Notion ID/URL, it is skipped with a warning.
