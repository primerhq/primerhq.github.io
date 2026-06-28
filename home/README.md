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
| Triggers     | `trigger-create-dark.png`              |
| Harnesses    | `harness-dark.png`                     |
| MCP          | `mcp-exposure-dark.png`                |

To wire them up: `cp _embeds/graph-canvas-dark.png home/` (etc). `home.js`
preloads each and swaps it in automatically; if a file is absent it silently
keeps the stand-in, so partial sets are fine.

**Empty-state captures:** the committed `collection-list`/`channels`/
`channel-provider-create` embeds were captured against empty fixtures (they show
"No X yet"), so they read as blank in the showcase. Collections uses the richer
`internal-collections-enable` capture instead. **Channels has no populated
capture, so its showcase tab was dropped** (channels stays listed as a capability
in the features lede and the Loop "Connectors" block). To restore the tab once a
populated `channels-dark.png` is captured in the `primer` repo (see its
`scripts/docs/` tooling): drop the PNG in here, re-add the `channels` entry to
`FEATURES`/`SHOT_IMG` in `home.js`, and the `data-tab="channels"` button in
`index.html`.
