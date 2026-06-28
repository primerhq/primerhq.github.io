# Docs Subpath Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the built documentation site from the domain root to `/docs/`, freeing `/` for a product homepage (built separately, Part B).

**Architecture:** A single `BASE_PATH = "/docs/"` constant in `build_site.py` drives every doc URL; the build writes pages, assets, and the search index under `out/docs/`, keeps `404.html` + `sitemap.xml` at the site root, and stops writing a root `index.html` (reserved for the homepage). Templates flip `<base href>` to `/docs/` so relative asset refs follow; `docs.js` fetches the search index relatively. A one-time migration regenerates the committed root output into this new shape.

**Tech Stack:** Python 3.13, `markdown-it-py`, `pyyaml`, `mdit-py-plugins`, pytest. No bundler.

**Scope:** This plan covers **Part A only** (the docs relocation + migration) of `design/specs/2026-06-28-homepage-and-docs-subpath-design.md`. **Part B** (the product homepage) is a separate designer-agent handoff, gated on the spec's Open Items, and is NOT in this plan. `.github/workflows/pages.yml` needs no change in Part A (the homepage-copy step is added in Part B); the existing `cp -r _embeds _site/_embeds` already keeps embeds at root.

## Global Constraints

- `BASE_PATH = "/docs/"` — exact value, keep the leading and trailing slash. Every doc URL, output dir, search-index URL, and sitemap doc-loc derives from it.
- The build must **not** write `out/index.html` (the site root is reserved for the homepage).
- `404.html` and `sitemap.xml` are written at the **site root** (`out/404.html`, `out/sitemap.xml`). The sitemap lists `/` (homepage) plus every `/docs/…` page.
- Component embeds stay at the site root (`/_embeds/<id>-{light,dark}.png`); `_render_embed` is unchanged.
- GitHub URL to use everywhere: `https://github.com/primerhq/primer`.
- Run tests from the repo root with `pytest tests/` (conftest puts `build/` on `sys.path`).
- Execute on a feature branch (or git worktree), not on `main`. Each task ends with a commit; commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `build/build_site.py` | Static site generator | Add `BASE_PATH`; `_doc_url` prefix; output under `out/docs/`; `/docs/` redirect index; drop root index; sitemap includes `/`; 404 gains a homepage link; `{{BASE}}` template substitution | Modify |
| `build/site_template/page.html` | Page shell | `<base href="{{BASE}}">`; fix GitHub URL | Modify |
| `build/site_template/docs.js` | Client JS (nav, search) | Relative `fetch("search-index.json")` | Modify |
| `tests/test_build_site.py` | Build output tests | Expect `/docs/` layout; add docs-root-redirect + no-root-index tests | Modify |
| `tests/test_build_search.py` | Search index tests | Index under `out/docs/`; exclude `/docs/` redirect from page count; `/docs/…` urls | Modify |
| `tests/test_build_render.py` | Markdown render tests | `/docs/`-prefixed slug map + assertions | Modify |
| repo root (`docs/`, `404.html`, `sitemap.xml`, old section dirs, `assets/`, `search-index.json`, `index.html`) | Committed built site | One-time migration to the new shape | Move/Delete |

---

## Task 1: Relocate the built docs site under `/docs/`

Make `build_site` emit a `/docs/`-rooted site (pages, assets, search index, `/docs/` redirect), keep `404.html` + `sitemap.xml` at root with the homepage in the sitemap, stop writing a root `index.html`, and fix the templates so pages resolve assets and the search index under `/docs/`.

**Files:**
- Modify: `build/build_site.py`
- Modify: `build/site_template/page.html`
- Modify: `build/site_template/docs.js`
- Test: `tests/test_build_site.py`, `tests/test_build_search.py`, `tests/test_build_render.py`

**Interfaces:**
- Consumes: existing `build_site(src_root, out_dir)`, `render_markdown(md_source, slug_url_map)`, `_render_root_redirect(home_url)`, `_render_404(template, sidebar, home_url)`, `_render_sitemap(page_urls)`.
- Produces: `BASE_PATH = "/docs/"` (module constant); `_doc_url(slug) -> "/docs/<slug>/"`; build output tree `out/docs/<slug>/index.html`, `out/docs/index.html` (redirect), `out/docs/assets/`, `out/docs/search-index.json`, `out/404.html`, `out/sitemap.xml`; no `out/index.html`.

- [ ] **Step 1: Update the build-site tests to expect the `/docs/` layout**

In `tests/test_build_site.py`, replace the bodies of `test_builds_a_page_per_doc`, `test_excludes_internal_meta_authoring_docs`, and `test_emits_404_and_sitemap`, and append two new tests:

```python
def test_builds_a_page_per_doc(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)
    page = out / "docs" / "getting-started" / "introduction" / "index.html"
    assert page.exists()
    home = page.read_text()
    assert "Features" in home and "LLM Providers" in home
    # Pages live under /docs/, so the base href and assets are rooted there.
    assert '<base href="/docs/"' in home
    assert (out / "docs" / "assets" / "docs.css").exists()
    # GitHub link points at the real repo, not the placeholder.
    assert "https://github.com/primerhq/primer" in home


def test_excludes_internal_meta_authoring_docs(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)
    # _meta is writer guidance, not public docs: no pages built for it.
    assert not (out / "docs" / "_meta").exists()
    assert not (out / "_meta").exists()


def test_emits_404_and_sitemap(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)

    notfound = out / "404.html"
    sitemap = out / "sitemap.xml"
    assert notfound.exists()
    assert sitemap.exists()

    # The 404 uses the page shell (sidebar nav present) and is a real page.
    nf_html = notfound.read_text()
    assert "Page not found" in nf_html
    assert "nav-link" in nf_html

    # The sitemap lists the homepage plus every published page url under /docs/.
    sm_xml = sitemap.read_text()
    assert "<urlset" in sm_xml
    assert "<loc>/</loc>" in sm_xml
    assert "<loc>/docs/getting-started/introduction/</loc>" in sm_xml


def test_docs_root_redirects_to_home(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)
    docs_index = out / "docs" / "index.html"
    assert docs_index.exists()
    # The bare /docs/ root redirects to the docs home page.
    assert "/docs/getting-started/introduction/" in docs_index.read_text()


def test_root_is_left_for_homepage(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)
    # The build no longer writes a root index.html; the homepage owns "/".
    assert not (out / "index.html").exists()
```

In `tests/test_build_search.py`, update `test_writes_search_index`: the index moves under `out/docs/`, the page count must exclude the `/docs/` redirect, and the known url is now `/docs/`-prefixed. Replace these lines:

```python
    index_path = out / "docs" / "search-index.json"
    assert index_path.exists()

    data = json.loads(index_path.read_text(encoding="utf-8"))
    assert isinstance(data, list)
    assert data, "search index should not be empty"

    # One entry per published doc. Exclude the site root and the /docs/
    # redirect index.html (neither is a published doc).
    docs_dir = out / "docs"
    page_count = sum(
        1 for p in out.rglob("index.html")
        if p.parent != out and p.parent != docs_dir
    )
    assert len(data) == page_count

    # No _meta urls leak in.
    assert all(not e["url"].startswith("/docs/_meta/") for e in data)
```

and update the known-entry lookup:

```python
    by_url = {e["url"]: e for e in data}
    llm = by_url.get("/docs/features/llm-providers/")
```

In `tests/test_build_render.py`, update the slug map and both assertions to the `/docs/` convention:

```python
SLUG_URL_MAP = {
    "getting-started/quickstart": "/docs/getting-started/quickstart/",
}
```

```python
def test_renders_heading_code_and_inline_ref():
    out = render_markdown(INLINE_MD, SLUG_URL_MAP)
    assert re.search(r'<h2 id="[^"]+"', out)
    assert "<pre><code" in out
    assert 'href="/docs/getting-started/quickstart/"' in out


def test_resolves_ref_block_form():
    out = render_markdown(BLOCK_MD, SLUG_URL_MAP)
    assert 'href="/docs/getting-started/quickstart/"' in out
    assert "Start here." in out
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_build_site.py tests/test_build_search.py tests/test_build_render.py -v`
Expected: FAIL — e.g. `test_builds_a_page_per_doc` fails because `out/docs/getting-started/introduction/index.html` does not exist (pages are still written at the root); render tests fail on the missing `/docs/` prefix.

- [ ] **Step 3: Add `BASE_PATH` and prefix `_doc_url` in `build/build_site.py`**

After the `_META_SECTION` definition (around line 38), add:

```python
# Every doc is served under this base path; the site root ("/") is reserved
# for the product homepage (a separate, designer-built artifact). Keep the
# leading and trailing slash.
BASE_PATH = "/docs/"
```

Change `_doc_url` (around line 55) to:

```python
def _doc_url(slug: str) -> str:
    """Map a full ``<section>/<basename>`` slug to its page url."""
    return f"{BASE_PATH}{slug}/"
```

- [ ] **Step 4: Write the output under `out/docs/`, redirect `/docs/`, drop the root index, and put the homepage in the sitemap**

In `build/build_site.py`, in `build_site()`:

Substitute `{{BASE}}` once, right after the template is read (around line 511):

```python
    template = (_TEMPLATE_DIR / "page.html").read_text(encoding="utf-8")
    template = template.replace("{{BASE}}", BASE_PATH)
```

In the per-entry loop, write each page under `docs/` (the `page_dir` assignment, around line 537):

```python
        page_dir = out_dir / "docs" / Path(entry.slug)
        page_dir.mkdir(parents=True, exist_ok=True)
        (page_dir / "index.html").write_text(page, encoding="utf-8")
```

Write the search index under `docs/` (around line 544):

```python
    (out_dir / "docs" / "search-index.json").write_text(
        json.dumps(search_index, ensure_ascii=False),
        encoding="utf-8",
    )
```

The 404 stays at the site root (its write target is unchanged). Replace the root-redirect block (around lines 562-567) with a `/docs/` redirect, and DELETE the old root `index.html` write:

```python
    # /docs/ landing: redirect the bare docs root to the docs home (the first
    # published page). The site root (/) is reserved for the product homepage,
    # a separate artifact, so the build no longer writes out/index.html.
    (out_dir / "docs").mkdir(parents=True, exist_ok=True)
    (out_dir / "docs" / "index.html").write_text(
        _render_root_redirect(home_url),
        encoding="utf-8",
    )
```

Include the homepage in the sitemap (around line 570) — keep it at the site root:

```python
    # sitemap.xml at the site root: the homepage plus every published page url.
    (out_dir / "sitemap.xml").write_text(
        _render_sitemap(["/"] + page_urls),
        encoding="utf-8",
    )
```

Write the assets under `docs/` (around line 578):

```python
    assets = out_dir / "docs" / "assets"
    assets.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 5: Add a homepage link to the 404 page**

In `_render_404` (around line 342), add a homepage link after the docs-home link:

```python
    article = (
        '<nav class="breadcrumb"><span>Docs</span> / '
        "<span>Not found</span></nav>"
        "<h1>Page not found</h1>\n"
        "<p>The page you were looking for does not exist or has moved.</p>\n"
        f'<p><a href="{html.escape(home_url)}">Back to the docs home</a></p>\n'
        '<p><a href="/">Back to the Primer home</a></p>\n'
    )
```

- [ ] **Step 6: Flip the template base href and fix the GitHub URL**

In `build/site_template/page.html`:

Line 6: `<base href="/" />` becomes:

```html
<base href="{{BASE}}" />
```

Line 42: the GitHub anchor `href="https://github.com"` becomes:

```html
      <a class="icon-btn" href="https://github.com/primerhq/primer" aria-label="GitHub" title="GitHub">
```

- [ ] **Step 7: Make the search-index fetch relative in `build/site_template/docs.js`**

Around line 230, change the absolute fetch so it resolves under `<base href="/docs/">` (base-path-agnostic):

```javascript
fetch("search-index.json")
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pytest tests/ -v`
Expected: PASS — all build, render, search, lint, frontmatter, and service tests green.

- [ ] **Step 9: Smoke-build and spot-check the output shape**

Run:

```bash
python build/build_site.py docs_source /tmp/site-check
ls /tmp/site-check                       # expect: docs/  404.html  sitemap.xml  (NO index.html)
ls /tmp/site-check/docs/assets           # expect: docs.css  docs.js
grep -c '<base href="/docs/"' /tmp/site-check/docs/getting-started/introduction/index.html   # expect: 1
grep -o '<loc>[^<]*</loc>' /tmp/site-check/sitemap.xml | head    # expect /  then /docs/... locs
```

Expected: `docs/` directory present, no root `index.html`, base href is `/docs/`, sitemap starts with `/` then `/docs/…` entries.

- [ ] **Step 10: Commit**

```bash
git add build/build_site.py build/site_template/page.html build/site_template/docs.js \
        tests/test_build_site.py tests/test_build_search.py tests/test_build_render.py
git commit -m "feat(build): serve docs under /docs/, reserve / for the homepage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migrate the committed root build output to the new shape

Regenerate the committed static site (served by classic branch-Pages) into the new layout: remove the old root-level built dirs/files, add the `docs/` tree, and refresh the root `404.html` + `sitemap.xml`. No root `index.html` yet — the homepage (Part B) provides it.

**Files:**
- Delete (committed root build output): `channels/ cookbook/ embedding/ features/ getting-started/ graphs/ reference/ toolsets/ web/ workspaces/ assets/ search-index.json index.html`
- Create/refresh: `docs/**`, `404.html`, `sitemap.xml`
- Keep untouched: `_embeds/`, `docs_source/`, `build/`, `tests/`, `.nojekyll`, `.github/`, `design/`

**Interfaces:**
- Consumes: the updated `build_site` from Task 1.
- Produces: a repo-root tree where the served docs live under `docs/`, with `404.html` + `sitemap.xml` at root and no root `index.html`.

- [ ] **Step 1: Build the new site into a scratch directory**

Run:

```bash
python build/build_site.py docs_source /tmp/site-new
```

Expected: exit 0; `/tmp/site-new/docs/`, `/tmp/site-new/404.html`, `/tmp/site-new/sitemap.xml` exist; no `/tmp/site-new/index.html`.

- [ ] **Step 2: Remove the old committed root build output**

Run (from repo root):

```bash
git rm -r --quiet channels cookbook embedding features getting-started graphs \
       reference toolsets web workspaces assets search-index.json index.html
```

Expected: those paths are staged for deletion. (`_embeds/`, `docs_source/`, `build/`, `tests/`, `404.html`, `sitemap.xml` remain.)

- [ ] **Step 3: Copy the regenerated output to the repo root**

Run:

```bash
cp -r /tmp/site-new/docs ./docs
cp /tmp/site-new/404.html ./404.html
cp /tmp/site-new/sitemap.xml ./sitemap.xml
```

Expected: a new root `docs/` tree; refreshed `404.html` and `sitemap.xml`.

- [ ] **Step 4: Verify the migrated tree**

Run:

```bash
test ! -e index.html && echo "no root index (correct)"
test -e docs/getting-started/introduction/index.html && echo "docs page present"
test -e docs/assets/docs.css && echo "docs assets present"
test -e _embeds/graph-canvas-dark.png && echo "embeds untouched"
grep -q '<loc>/docs/getting-started/introduction/</loc>' sitemap.xml && echo "sitemap rooted at /docs/"
```

Expected: all five echo lines print.

- [ ] **Step 5: Stage and review the migration diff**

Run:

```bash
git add docs 404.html sitemap.xml
git status
```

Expected: old section dirs + `assets/` + `search-index.json` + root `index.html` deleted; `docs/`, refreshed `404.html`, `sitemap.xml` added/modified. Confirm `_embeds/` and `docs_source/` are NOT in the diff.

- [ ] **Step 6: Commit**

```bash
git commit -m "build: migrate committed site output to /docs/ layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Interim root 404:** until Part B lands, the site root (`/`) has no page. GitHub Pages is not yet enabled for this repo (the workflow is inert until Settings → Pages is switched on), so there is no public 404 window. Do not add a stopgap root redirect — the homepage will own `/`.
- **`pages.yml` is unchanged in this plan.** The build now emits `_site/docs/**`; the existing `cp -r _embeds _site/_embeds` and the `_site` artifact upload already cover it. The homepage-copy step is added with Part B.
- **Old on-disk docs:** unrelated stale section markdown may exist under `docs_source/` from earlier refactors (out of the manifest). This plan does not touch corpus content.

## Self-Review

- **Spec coverage (Part A):** A.1 URL contract → Task 1 (output layout, `/docs/` redirect, 404+sitemap at root). A.2 build changes → Task 1 Steps 3-5. A.3 template/asset fixes → Task 1 Steps 6-7. A.4 CI → Notes (no change needed in Part A). A.5 migration → Task 2. A.6 tests → Task 1 Steps 1-2, 8. All Part A sections map to a task. Part B is explicitly out of scope.
- **Placeholder scan:** every code step shows exact code; commands include expected output; no TBD/TODO.
- **Type consistency:** `BASE_PATH` (str, `"/docs/"`) is defined in Task 1 Step 3 and used by `_doc_url` (Step 3) and the template substitution (Step 4); test paths (`out/docs/...`, `out/docs/search-index.json`) match the build's write targets; `_render_sitemap(["/"] + page_urls)` matches the existing `_render_sitemap(page_urls: list[str])` signature; `_render_root_redirect(home_url)` reused unchanged.
