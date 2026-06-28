# Design: product homepage at `/` + docs moved to `/docs/`

Date: 2026-06-28
Status: Draft for review

## Goal

`primerhq.github.io` currently serves the documentation at the domain root. We
want:

1. A polished **product homepage at `/`** (a single-page marketing landing
   page), produced by the `designer` agent from a detailed brief (this doc).
2. The **documentation relocated under `/docs/`** (e.g.
   `/docs/features/agents/`), via a contained change to the existing build.

The two are independent artifacts: the build owns everything under `/docs/`
(plus the site-wide `/404.html` and `/sitemap.xml`); the homepage owns the root
(`/index.html` + its own assets). They never write the same files.

## Constraints

- **GitHub Pages, org site** (`primerhq.github.io`): served at the domain root,
  static files only, **no server-side rendering or redirects**. All routing is
  by directory + `index.html`.
- The built docs site is **committed at the repo root** (so classic
  branch-Pages serves it) *and* deployed via `.github/workflows/pages.yml`. Both
  must keep working.
- Homepage stack (decided): **vanilla static HTML/CSS/JS, CDN libraries only**
  (no bundler / no SSR), matching the repo's existing no-build-tool norm.
- Homepage brand (decided): **cohesive but bolder** — reuse the docs design
  tokens, fonts, and logo, with a more expressive marketing treatment.

## Decisions (confirmed)

| Question | Decision |
|----------|----------|
| Docs base path | `/docs/` |
| Bare `/docs/` behavior | Redirect to `/docs/getting-started/introduction/` |
| Legacy root doc URLs (`/features/agents/`) | **No** redirect stubs (site not publicly live yet) |
| `sitemap.xml` location | **Root** `/sitemap.xml`, listing `/docs/…` pages + the homepage `/` |
| Homepage production | Standalone, built by the `designer` agent (not by `build_site.py`) |
| Homepage stack | Vanilla static + CDN libs |
| Homepage brand | Cohesive with docs, bolder marketing treatment |
| Emphasis | Loop engineering · context-over-scale · building blocks · open-source/self-hosted |

---

# Part A — Docs relocation to `/docs/`

## A.1 URL contract

| URL | Serves |
|-----|--------|
| `/` | Product homepage (Part B) |
| `/docs/` | Meta-refresh + JS redirect → `/docs/getting-started/introduction/` |
| `/docs/<section>/<slug>/` | Each doc page |
| `/docs/assets/docs.css`, `/docs/assets/docs.js` | Docs assets |
| `/docs/search-index.json` | Client search index (fetched by docs.js) |
| `/sitemap.xml` | Root sitemap: homepage `/` + every `/docs/…` page |
| `/_embeds/<id>-{light,dark}.png` | Screenshots — **stay at root**, unchanged |
| `/404.html` | Site-wide 404 (Pages serves it for any missing path) |

## A.2 `build_site.py` changes

The whole prefix flows from one place. Introduce a module-level
`BASE_PATH = "/docs/"` and:

1. **`_doc_url(slug)`** returns `f"{BASE_PATH}{slug}/"` instead of `f"/{slug}/"`.
   This single change propagates the prefix to: sidebar nav links
   (`_nav_link`), page output directories, `slug_url_map` (so resolved `ref:`
   links point under `/docs/`), search-index `url` fields, sitemap `<loc>`s, and
   the 404 "home" link.
2. **Output layout** in `build_site()`:
   - Pages → `out/docs/<slug>/index.html` (i.e. write under `out / "docs" /
     Path(slug)`).
   - `search-index.json` → `out/docs/search-index.json`.
   - `assets/docs.css`, `assets/docs.js` → `out/docs/assets/`.
   - `/docs/` redirect index → `out/docs/index.html` (reuse the existing
     `_render_root_redirect`, pointed at the docs home).
   - **`404.html` → `out/404.html`** (stays at site root).
   - **`sitemap.xml` → `out/sitemap.xml`** (root), with `<loc>`s for `/` plus
     every `/docs/…` page url (prepend the homepage url to `page_urls`).
   - **No root `out/index.html`** — the homepage owns root. Remove the
     root-redirect write; replace with the `/docs/` redirect above.
3. **Template substitution**: add a `{{BASE}}` placeholder (see A.3) set to
   `/docs/`.

> The 404 page is served at the domain root but uses the same template with
> `<base href="/docs/">`. Because the base href is absolute, its relative asset
> refs still resolve to `/docs/assets/…` and its "home" link is the absolute
> `/docs/getting-started/introduction/` — both correct from any 404 path. Add a
> secondary link to `/` (the homepage) in the 404 article.

## A.3 Template + asset fixes

- `build/site_template/page.html`:
  - `<base href="/" />` → `<base href="{{BASE}}" />` (rendered to `/docs/`).
    This is what lets the relative `assets/docs.css` / `assets/docs.js` refs
    resolve under `/docs/` with no per-link edits.
  - The brand link `href="/"` stays — it now points to the product homepage
    (desirable). Consider relabeling the brand area so "Docs" is distinct from
    going to the home site (designer/Part B can supply a matching top bar).
  - The GitHub icon `href="https://github.com"` → `https://github.com/primerhq/primer`.
- `build/site_template/docs.js`:
  - Line ~230: `fetch("/search-index.json")` → `fetch("search-index.json")`
    (relative; resolves under `<base href="/docs/">`, base-path-agnostic).
  - Active-nav highlighting keys on `location.pathname` vs. nav `href`s; both are
    `/docs/`-prefixed after the change, so matching still holds. No change.
- `_render_embed` stays as-is (srcset remains `/_embeds/…` at root).

## A.4 CI (`.github/workflows/pages.yml`)

The build step `python build/build_site.py docs_source _site` now emits
`_site/docs/**`, `_site/404.html`, and `_site/sitemap.xml`. Update the workflow:

- Keep `cp -r _embeds _site/_embeds` (embeds remain at root).
- **Add** a step to copy the committed homepage artifact into `_site/` root:
  `cp index.html home.css home.js _site/ && cp -r home _site/home` (exact file
  list per Part B's final output).

## A.5 One-time migration (committed root output)

1. `git rm -r` the old committed root build output: `channels/ cookbook/
   embedding/ features/ getting-started/ graphs/ reference/ toolsets/ web/
   workspaces/ assets/ search-index.json sitemap.xml`.
2. Run the updated build into a temp dir and commit the regenerated tree as
   `docs/**` + `404.html` + `sitemap.xml` at the repo root.
3. Add the homepage artifact at root (Part B).
4. Keep `_embeds/`, `docs_source/`, `build/`, `tests/`, `.nojekyll`.

> Note: the **built** docs site is the repo-root `docs/` directory (so
> `/docs/features/agents/` maps to `docs/features/agents/index.html`). Internal
> design specs deliberately live OUTSIDE it — this file is under `design/specs/`
> — so the build never clobbers them and they are not part of the published doc
> tree. The build only ever writes the manifest's section dirs, `assets/`,
> `index.html`, and `search-index.json` under `docs/`.

## A.6 Tests

Update the build tests for the new layout/urls and add coverage:

- `tests/test_build_site.py` — pages now at `out/docs/<slug>/index.html`;
  `404.html` + `sitemap.xml` at `out/`; assert **no** `out/index.html`; assert
  `out/docs/index.html` redirect exists.
- `tests/test_build_render.py` — rendered nav/`ref:` hrefs are `/docs/…`.
- `tests/test_build_search.py` — search-index `url`s are `/docs/…`; file at
  `out/docs/search-index.json`.
- New: sitemap at root contains `/` and `/docs/…` locs.

---

# Part B — Product homepage (designer brief)

This part is the **brief handed to the `designer` agent**. It is self-contained
so it can be lifted verbatim as the agent prompt.

## B.0 Output contract (what the designer must produce)

Static files committed at the repo **root**, kept clearly separate from the
docs output under `/docs/`:

- `index.html` — the homepage
- `home.css` — homepage styles (do not reuse the docs `assets/docs.css` file
  directly; instead **re-declare the same design tokens** so the homepage is
  self-contained and can be bolder)
- `home.js` — homepage interactions/animations (vanilla)
- `home/` — homepage-only images/SVGs/Lottie/`.riv` files

**Hard constraints:**

- Pure static: hand-written HTML/CSS/JS. **No bundler, no framework build, no
  SSR.** External libraries only via CDN `<script>`/`<link>` (the docs already
  load mermaid this way).
- Must render correctly with JS disabled (progressive enhancement): content and
  layout read fine; animations are enhancement only.
- Responsive down to a 390px viewport; the install command block must not
  overflow.
- Respect `prefers-reduced-motion: reduce` for **every** animation (gate scroll
  and looping motion behind `@media (prefers-reduced-motion: no-preference)`).
- Performance budget: target Lighthouse perf ≥ 95 on mid-tier hardware. No
  layout shift from hero animation. Total added JS (CDN libs) under ~80KB
  gzipped combined.

## B.1 Brand system (match the docs, then go bolder)

Reuse these exact tokens (from `build/site_template/docs.css`) so the homepage
and docs read as one product. Bolder marketing treatments (larger type,
gradients, an animated hero, the signature infographics) are encouraged on top.

```
--bg:        oklch(0.155 0.005 250);   /* near-black base */
--bg-1:      oklch(0.185 0.005 250);
--bg-2:      oklch(0.22 0.005 250);
--border:    oklch(0.28 0.005 250);
--text:      oklch(0.95 0.005 250);
--text-2:    oklch(0.72 0.005 250);
--text-3:    oklch(0.55 0.005 250);
--accent:    oklch(0.82 0.17 145);     /* green — primary accent */
--accent-2:  oklch(0.72 0.18 145);
--accent-dim:oklch(0.82 0.17 145 / 0.12);
--blue:      oklch(0.74 0.14 240);
--amber:     oklch(0.82 0.16 75);
--red:       oklch(0.7 0.2 25);
--violet:    oklch(0.72 0.16 290);
```

- **Fonts:** IBM Plex Sans (UI/body), IBM Plex Mono (code, labels, stats). Load
  from Google Fonts as the docs template does.
- **Default theme is dark.** A light variant is optional; the docs support a
  theme toggle, so a matching toggle is a nice-to-have, not required.
- **Logo** (faceted diamond — copy from `page.html`, currentColor + `--accent`
  on the bottom facet):

```html
<svg width="22" height="22" viewBox="0 0 24 24">
  <polygon points="12,3 21,12 12,21 3,12" fill="currentColor" fill-opacity="0.18"/>
  <polygon points="12,3 16.5,7.5 12,12 7.5,7.5" fill="currentColor"/>
  <polygon points="16.5,7.5 21,12 16.5,16.5 12,12" fill="currentColor" fill-opacity="0.45"/>
  <polygon points="12,12 16.5,16.5 12,21 7.5,16.5" fill="var(--accent)"/>
  <polygon points="7.5,7.5 12,12 7.5,16.5 3,12" fill="currentColor" fill-opacity="0.45"/>
</svg>
```

A premium hero moment: animate the diamond facets assembling on load (Lottie or
hand-animated SVG), ~600ms, once.

## B.2 The product (ground truth — use only these facts)

Primer is an **unopinionated, batteries-included agent orchestration platform
with a focus on context optimization**, that you **self-host**.

- **Core thesis — context, not scale.** A model spreads a fixed attention budget
  across all tokens at once; a bloated context dilutes the few tokens that
  matter (the "lost in the middle" effect). Primer keeps each agent's context
  small and purpose-built so even small models stay accurate. This is a
  hypothesis Primer is built to test, not a settled result — phrase it as a bet,
  not a guarantee.
- **Loop engineering.** Primer provides the building blocks for designing agent
  loops: a **heartbeat** (triggers: cron/delay/webhook), **isolation**
  (git-backed workspaces: local/container/Kubernetes), **durable memory**
  (workspaces + knowledge collections), a **maker + checker** (directed cyclic
  graphs: producer drafts, judge critiques, loop until it passes),
  **connectors** (MCP server/client; Slack/Telegram/Discord channels), and a
  **human gate** (approvals; park-and-resume).
- **Building blocks (batteries included):** LLM providers, agents, graphs,
  knowledge collections (vector search), workspaces & sessions, channels,
  triggers, harnesses (exportable git-backed bundles — "Helm for agents"), an
  MCP server.
- **Self-hosted, runs on your hardware.** Install today by cloning and running
  from source:

```
git clone https://github.com/primerhq/primer.git
cd primer
uv sync
uv run primer api
```

Then open the console at `http://localhost:8000/console/`. (Released-artifact
install is planned; until then it is clone-and-run.)

- **Repo:** https://github.com/primerhq/primer

### Honesty constraints (do NOT fabricate)

- **No invented metrics** — no star counts, "X agents run", "Y companies", or
  uptime numbers unless supplied as real values (see Open Items). If absent,
  omit the stat/trust-band entirely.
- **No fabricated testimonials or customer logos.** Omit the social-proof
  section unless real, attributed quotes are provided.
- **License wording is unconfirmed** — there is no LICENSE file in the repo yet.
  Do **not** assert "MIT" or a specific license, and do not claim "zero
  telemetry." Use "self-hostable / runs on your own hardware / source on
  GitHub." (See Open Items — the user will confirm exact OSS wording.)

## B.3 Page structure

Single page, dark, generous vertical rhythm. Sections in order (drop any section
whose real content we lack rather than padding it):

1. **Top bar** — logo + wordmark, anchor links (Problem · Loop · Install ·
   Features · Docs), a "Docs" button → `/docs/`, a GitHub link →
   `github.com/primerhq/primer`. Sticky, translucent on scroll.
2. **Hero** — headline + one-sentence subhead + the literal install command
   (copy button) as the primary CTA; secondary CTA "Read the docs" → `/docs/`.
   Visual: animated diamond logo and/or the producer–judge loop diagram
   (B.4-b). Background: a radial oklch green glow on near-black (CSS gradient,
   no particle system). Headline direction (pick/refine): "Build the loop.
   Trust the output." / subhead "An unopinionated, batteries-included agent
   orchestration platform you self-host — built so a small, clean context beats
   a big one."
3. **The problem — context, not scale** — the tight-vs-bloated infographic
   (B.4-a) with two sentences of the thesis. The diagram is the centerpiece.
4. **The loop — producer/judge** — the animated DCG diagram (B.4-b) with the
   loop-engineering framing and its six building blocks (heartbeat, isolation,
   durable memory, maker+checker, connectors, human gate) as a compact list.
5. **Install in minutes** — a terminal component showing the three commands
   (staggered reveal, copy buttons) + the console URL. One sentence: "Runs
   locally on your hardware."
6. **Batteries included** — the building blocks as a bento/tabbed grid: Agents ·
   Graphs · Collections · Channels · Triggers · Harnesses · MCP. Each tile: icon
   + short label + one line + a "Learn more →" deep link into the matching
   `/docs/…` page. Use the real console screenshots from `_embeds/` (B.5) on
   hover or in a showcase strip.
7. **(Optional) Recipes** — cards linking to cookbook recipes
   (`/docs/cookbook/…`): scheduled-stock-monitor, incident-responder,
   support-desk, release-conductor, code-interpreter, graphs. Each: name +
   one-line + "View recipe →". Pure content, no heavy motion.
8. **Self-hosted** — the trust message: "Your data stays on your hardware. Run
   it where you want; the source is on GitHub." Keep it plain (plainness reads
   as honesty). One "View on GitHub" CTA. (Exact OSS/license wording pending —
   Open Items.)
9. **Final CTA** — repeat the install command; "Read the docs" + "View on
   GitHub". A visually distinct block (green accent).
10. **Footer** — Docs · Cookbook · GitHub · (Changelog/Community if real).
    Minimal.

> Omit the "trust band stats" and "social proof / testimonials" sections by
> default — we have no real data for them yet (B.2 honesty constraints).

## B.4 The two signature infographics (the centerpieces)

Build these as crisp, buildable, accessible animations. They carry the page.

**(a) Tight vs. bloated context ("lost in the middle").**
A horizontal "attention heat bar" representing a context window: bright
`--accent` at the left and right ends, dimming to `--text-3`/`--red` in the
middle ("what the model actually attends to"). Below it, a second bar — Primer's
tight context — bright edge-to-edge. On scroll-into-view, the bloated bar fades
in and the dim middle settles, then the tight bar slides in; label the middle
"the model loses this." Alternative/companion: a small SVG line chart (accuracy
vs. context size) with two lines — naive (drops after ~8k tokens) vs. Primer
(flat) — drawn via `stroke-dashoffset` on scroll. No library required; GSAP
optional for the heat-bar choreography.

**(b) The producer–judge loop (loop engineering).**
An SVG directed cyclic graph: **Trigger → Producer → Judge**, with a retry edge
(Judge → Producer) and an escalation edge (Judge → Human), plus a pass edge
(Judge → ✓ Deliver). A colored dot travels the edges in sequence: trigger fires,
producer pulses, judge evaluates (pause), then either loops back (dimmer = retry),
escalates (violet → human), or passes (green → deliver). ~3–4s loop,
auto-repeats, starts on scroll-into-view. This is the single most important
visual — it should explain Primer's value in one watch, no reading required.
Color the states with the tokens (retry amber, escalate violet, pass green).
GSAP + ScrollTrigger (CDN) is the recommended tool; a pinned scrollytelling
variant (diagram fixed, text beats scrolling alongside) is a stretch goal.

## B.5 Real assets to use

Use the committed console screenshots in `_embeds/` (light+dark pairs; pick the
dark variant for the dark page, or use a `<picture>` with both). Strong
candidates by section:

- Hero / Features showcase: **`graph-canvas`** (the visual graph editor — the
  most striking shot), **`agents-page`**, **`chat-agent-switch`**.
- Building blocks tiles: `agents-page` (Agents), `graph-canvas` (Graphs),
  `collection-list`/`collection-create` (Collections), `channels`/
  `channel-provider-create` (Channels), `trigger-create` (Triggers), `harness`
  (Harnesses), `mcp-exposure` (MCP).
- Loop/operations flavor: `session-detail`, `sessions-list`, `workspaces`,
  `approvals` (human gate).

Full set (28 subjects): agents-page, api-token-create, approvals,
channel-provider-create, channels, chat-agent-switch, chat-stream,
collection-create, collection-list, cross-encoder-provider, embedding-provider,
graph-canvas, harness, internal-collections-enable, llm-provider-openrouter,
mcp-exposure, quickstart-agents, quickstart-graph, session-detail, sessions-list,
ssp, toolsets, trigger-create, web-search, workers-stats,
workspace-provider-create, workspaces, workspace-template-form.

Screenshots referenced by the homepage should be **copied into `home/`** (do not
depend on `/_embeds/` pathing) so the homepage is self-contained.

## B.6 Motion toolkit (CDN only)

- **Lenis** (~2.6KB) — smooth scroll, page-wide premium feel. Disable on reduced
  motion.
- **GSAP + ScrollTrigger** (~42KB) — the two signature infographics + any
  pinned/sequenced scroll choreography.
- **Native CSS scroll-driven animations** (`animation-timeline: view()`) — simple
  section reveals (zero JS; Firefox degrades gracefully).
- **Lottie-light** (~50KB) *or* hand-animated SVG — the diamond logo assemble
  (logo only, used sparingly).
- Avoid: particle/WebGL hero backgrounds (dev audiences are skeptical; perf
  cost), scroll-jacking, anything that drops frames at 1× CPU throttle.

## B.7 Reference set (for craft, not copying)

Closest-in-concept exemplars to study (durable workflows / agents / infra,
dark + accent aesthetic): **Inngest** (before/after tangle diagram; primitives
in compact boxes), **Temporal** (four-step SVG "how it works"; code-as-hero),
**Trigger.dev** (agentic pattern cards → docs deep links), **Linear** (workflow
scroll narrative; craft), **Supabase** (dark + green; product-grid-as-nav),
**Neon** (CLI command in hero; dark glow), **Bun/Turborepo** (install command in
hero; specificity). Static-friendly component references: **HyperUI** (pure
Tailwind HTML, no build), **Tailwind Plus marketing blocks**, **AstroWind**
(structure), **Aceternity/Magic UI** (animation *ideas* to re-implement in
vanilla CSS/JS — animated beams for the loop diagram, aurora/grid backgrounds).

## B.8 Pitfalls to avoid (dev/open-source audience)

Install command visible in the hero (never hidden behind a modal); replace vague
adjectives with mechanisms/numbers; no fake testimonials/logos; no janky/heavy
animation (must be invisible when working); show real product (screenshots +
the real install commands); CTA matches the model ("Install"/"View on GitHub",
not "Start free trial"); make Docs easy to find (link it repeatedly); don't break
on mobile; match the existing Primer aesthetic exactly.

---

# Open items (need user confirmation)

1. **OSS/license wording.** No LICENSE file exists. Confirm: is Primer
   open-source, and under what license? May the homepage say "open source" /
   name a license / claim "no telemetry"? Default until confirmed: "self-hostable,
   source on GitHub," no license claim.
2. **Real metrics / social proof.** Provide any real numbers (GitHub stars,
   production users, quotes) to include — otherwise those sections are omitted.
3. **Headline/voice.** The headline directions in B.3 are starting points; the
   user may want a specific tagline.
4. **Console URL / demo.** Is there a public hosted demo or only local
   (`localhost:8000/console/`)? Affects whether a "Try it" link exists.

# Rollout order

1. Land Part A (build + template/asset changes + tests) — docs move to `/docs/`,
   homepage absent yet (root temporarily 404s until step 3, acceptable
   pre-launch).
2. Resolve Open Items 1–4.
3. Designer agent builds the homepage from Part B; commit at root; update CI to
   copy it into `_site`.
4. Verify locally (build + serve), then enable Pages.
