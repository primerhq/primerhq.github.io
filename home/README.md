# home/ — homepage assets

Self-contained images for the Primer homepage. The page works without any files
here (the "Batteries included" showcase renders a CSS console stand-in as a
fallback), but for production drop in the **dark** screenshot variants from
`_embeds/` so the showcase shows real product UI.

Expected filenames (copied from `_embeds/<id>-dark.png`), referenced by `home.js`:

| Tab          | File                                   |
|--------------|----------------------------------------|
| Agents       | `agents-page-dark.png`                 |
| Graphs       | `graph-canvas-dark.png`                |
| Collections  | `internal-collections-enable-dark.png` |
| Channels     | _(none — CSS stand-in; see below)_     |
| Triggers     | `trigger-create-dark.png`              |
| Harnesses    | `harness-dark.png`                     |
| MCP          | `mcp-exposure-dark.png`                |

To wire them up: `cp _embeds/graph-canvas-dark.png home/` (etc). `home.js`
preloads each and swaps it in automatically; if a file is absent it silently
keeps the stand-in, so partial sets are fine.

**Empty-state captures:** the committed `collection-list`/`channels`/
`channel-provider-create` embeds were captured against empty fixtures (they show
"No X yet"), so they read as blank in the showcase. Collections uses the richer
`internal-collections-enable` capture instead; Channels has no populated capture
yet and falls back to the CSS stand-in. The real fix is re-capturing those embeds
against a seeded fixture in the `primer` repo (see its `scripts/docs/` tooling).
