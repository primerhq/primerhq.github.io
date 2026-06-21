# primer docs

The primer user documentation: source, build tooling, and the published
static site, all in one repo.

## Layout

| Path | What |
|------|------|
| `docs_source/` | The docs: markdown per section, `manifest.yaml` (the nav/IA), `_fixtures/` (API response snapshots used by the component embeds), `_meta/` (authoring guides, not published) |
| `build/` | The static-site generator: `build_site.py`, `docs_lint.py`, `user_docs_service.py`, `user_docs_lint.py`, `site_template/`, `requirements.txt` |
| `tests/` | Tests for the build (render, directives, search index) |
| `_embeds/` | Committed component screenshots referenced by the pages (regenerated cross-repo, see below) |
| `.github/workflows/pages.yml` | Builds `docs_source/` and deploys to Pages on push (active once the repo is published) |
| (repo root html) | The built site (committed so classic branch-Pages serves it too) |

## Editing docs

Edit markdown under `docs_source/`. Add a page by creating the markdown file
and referencing it in `docs_source/manifest.yaml` (the manifest drives the
sidebar and the set of built pages).

## Building locally

```bash
pip install -r build/requirements.txt
python build/build_site.py docs_source _site      # -> _site/
python build/docs_lint.py                         # lint only
pip install pytest && pytest tests/               # build tests
```

## Refreshing embeds and fixtures (needs the primer repo)

The component screenshots (`_embeds/*.png`) and the API fixtures
(`docs_source/_fixtures/*.json`) are rendered from the live primer console UI
/ a running primer server, so they are refreshed from the `primer` repo (which
holds `ui/` and the running app), writing their output back into this
checkout. See the primer repo's `scripts/docs/` capture tools. Day-to-day docs
editing does not touch them.
