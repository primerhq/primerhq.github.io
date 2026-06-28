# home/ — homepage assets

Self-contained images for the Primer homepage. The page works without any files
here (the "Batteries included" showcase renders a CSS console stand-in as a
fallback), but for production drop in the **dark** screenshot variants from
`_embeds/` so the showcase shows real product UI.

Expected filenames (copied from `_embeds/<id>-dark.png`), referenced by `home.js`:

| Tab          | File                          |
|--------------|-------------------------------|
| Agents       | `agents-page-dark.png`        |
| Graphs       | `graph-canvas-dark.png`       |
| Collections  | `collection-list-dark.png`    |
| Channels     | `channels-dark.png`           |
| Triggers     | `trigger-create-dark.png`     |
| Harnesses    | `harness-dark.png`            |
| MCP          | `mcp-exposure-dark.png`       |

To wire them up: `cp _embeds/graph-canvas-dark.png home/` (etc). `home.js`
preloads each and swaps it in automatically; if a file is absent it silently
keeps the stand-in, so partial sets are fine.
