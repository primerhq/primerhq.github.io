---
slug: authoring-guide
title: Authoring guide
section: _meta
summary: How to add or edit a doc; what the directives do; what the lint rules block.
---

## Where docs live

Operator-facing docs live under `docs_source/<section>/<slug>.md` in the
`primerhq.github.io` repo. The visible sections are listed in
`docs_source/manifest.yaml`;
the manifest also controls ordering and visible-doc membership.
Docs on disk but absent from the manifest are reachable by direct
slug but hidden from the left nav.

## The built site is committed

`docs_source/` is the source; the rendered site is committed at the repo root
(`docs/`, `404.html`, `sitemap.xml`) so classic branch-Pages can serve it.

**Regenerate it in the same commit as any source change**, or the published
pages drift from the markdown:

```bash
python build/build_site.py docs_source _site
rm -rf docs && cp -r _site/docs docs
cp _site/404.html _site/sitemap.xml .
```

Adding a page to `manifest.yaml` changes the sidebar, which is rendered into
every page, so expect the whole corpus to show a small diff. That is normal;
each untouched page should differ only by the nav lines.

## The lint

The doc service runs the lint after every reload. In dev mode
(env var `PRIMER_USER_DOCS_STRICT=1`) lint errors block startup.
In production they log loudly and the offending doc is excluded
from the manifest. Highlights:

- The em-dash character is rejected anywhere in a doc source. Use
  the regular hyphen, the double-hyphen, or rework the sentence.
- Every `ref:<slug>` and `ai-doc:<slug>` resolves at lint time.
- Every `embed:<id>` is checked against the embed registry
  (`docs_source/_fixtures/registry.json`).
- Required frontmatter keys: slug, title, summary, section.
  Cookbook docs also require difficulty, time_minutes, tags.

## The six directives

### callout

```callout:info
This is what the info kind looks like in real prose.
```

Severity variants: `info`, `warning`, `danger`, `tip`.

### ref

```ref:features/agents
Links to another doc by slug.
```

### ai-doc

```ai-doc:agents
```

### code-tabs

```code-tabs:python,curl
--- python
print("hello")
--- curl
curl https://example/v1/hello
```

### mermaid

```mermaid
flowchart LR
  A --> B
  B --> C
```

### embed

Renders a real console component from the embed registry with fixtures.
The id must match an entry in `docs_source/_fixtures/registry.json`.
The component is rendered inside an iframe using live fixture data --
no hand-drawn JSX required.

```embed:agents-page
```

Valid embed ids are listed in the registry. An unregistered id is
a lint error (`unknown_embed_id`).

## A small architecture sketch

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Ed as Editor
  participant Fs as docs_source/
  participant Svc as UserDocsService
  Op->>Ed: save .md file
  Ed->>Fs: write
  Svc->>Fs: stat on next request
  Fs->>Svc: mtime advanced
  Svc->>Op: serve fresh content
```

## Adding a new directive

The directive registry lives in `ui/vendor/markdown.jsx`. Each
directive registers a handler via `window.MarkdownDirectives.register`.
The handler receives the body and returns a React node.

## Adding a new embed

1. Add the fixture JSON under `docs_source/_fixtures/<id>.json`.
2. Register the id in `docs_source/_fixtures/registry.json`.
3. Implement the component in `ui/components/docs/directives-embed.jsx`
   (or a dedicated file loaded before it).
4. Use `embed:<id>` in the doc body. The lint will verify the id on
   next reload.
