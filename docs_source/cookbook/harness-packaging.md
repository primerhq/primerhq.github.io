---
slug: cookbook-harness-packaging
title: Package and ship entities as a harness
section: cookbook
summary: "Bundle a set of agents, collections, and graphs into a versioned harness, push it to a git repo, and install it into another primer, all from the console or with the primectl CLI."
difficulty: advanced
time_minutes: 20
tags: ["harnesses", "packaging", "git", "deployment"]
---

## Goal

You have built something good on one primer - a knowledge base and its Q&A agent,
say - and you want to ship it: version it, push it to git, and install it into
another primer (a teammate's, staging, prod). A **harness** is that package. An
**outbound** harness templatizes a chosen set of entities and pushes a bundle to git;
an **inbound** harness installs that bundle elsewhere.

This recipe is primer's own packaging/deployment story - think "Helm chart for
primer entities". Every step is shown two ways: first **in the console** (the
Harnesses page has Build, Push, Fetch, and Install buttons), then **via the CLI**
with the exact `primectl` command. Pick whichever you prefer.

## Ingredients

- **A git repo** the harness can push to (any URL the server can reach; this recipe
  uses a local bare repo created with `git init --bare`).
- The entities you want to ship - here the `kb` collection and `kb-qa` agent from the
  [RAG knowledge base](cookbook-rag-knowledge-base) recipe.
- To drive the CLI path, point `primectl` at your instance once (mint a token, set the
  context); see the one-time
  [Connecting the CLI](cookbook-rag-knowledge-base) block in the RAG recipe.

The harness operations (build, push, fetch, install) are **asynchronous**: the server
enqueues each on its claim engine and the entity carries a `pending_operation` until
it clears. In the console the harness detail page refreshes itself while an operation
runs; on the CLI you poll the harness between steps.

## Walkthrough

### 1. Create an outbound harness

List the entities to ship as `tracked_entities`. Each names the source entity by
`source_id` (the id of the live entity to ship) and the `template_name` it gets in the
bundle. `git_url` is mandatory at create - it is where the bundle goes.

In the console:

1. Go to **Harnesses** and click **New harness**.
2. Set **Direction** to `outbound`, set a **Slug** (`kb-pack`) and **Name**, and set
   the **Git URL** to your push target (for example `file:///srv/git/kb-pack.git`).
3. Add the **tracked entities**: pick the `kb` collection with template name `kb`, and
   the `kb-qa` agent with template name `kb-qa`.
4. Click **Create**.

Via the CLI:

```
primectl create -f outbound.yaml
```

where `outbound.yaml` is:

```yaml
kind: harness
spec:
  slug: kb-pack
  name: KB Q&A pack
  description: Reusable IT-support KB + Q&A agent.
  git_url: file:///srv/git/kb-pack.git
  ref: main
  direction: outbound
  tracked_entities:
    - kind: collection
      template_name: kb
      source_id: kb
    - kind: agent
      template_name: kb-qa
      source_id: kb-qa
```

### 2. Build, then push

**Build** templatizes the tracked entities into a bundle (computes a `bundle_hash`)
and leaves the harness in `draft`; **push** commits that bundle to git and records
`last_pushed_commit`. Build and push are separate: build renders, push writes to git.

In the console:

1. Open the harness detail page and click **Build**. Watch the status: when the
   operation clears, the harness shows a `bundle_hash` and no error, still `draft`.
2. Click **Push**. When it clears, `last_pushed_commit` is set; the commit titled
   `primer outbound: kb-pack @ <timestamp>` on the `main` ref now holds the bundle.

Via the CLI:

```
primectl call harness build <harness-id>
primectl get harness <harness-id> -o yaml   # poll until pending_operation clears
primectl call harness push <harness-id>
primectl get harness <harness-id> -o yaml   # poll until last_pushed_commit is set
```

The pushed commit contains the bundle:

```
harness.yaml            # the manifest (apiVersion: primer/v1, kind: Harness, version)
overrides.schema.json   # the schema for install-time overrides
templates/kb.yaml       # the templatized collection
templates/kb-qa.yaml    # the templatized agent
```

### 3. Install it into another primer

On the target primer, create an **inbound** harness pointing at the same `git_url`,
then fetch and install. Fetch pulls the bundle from git; install materializes the
templates as real entities. Supply `overrides` for anything the bundle parameterized
(ids, provider ids, models).

In the console (on the target primer):

1. Go to **Harnesses**, click **New harness**, set **Direction** to `inbound`, and set
   the same **Git URL** and **ref**. Click **Create**.
2. On the detail page click **Fetch**. When it clears, the **Overrides** editor is
   populated from the bundle's `overrides.schema.json`; fill any values you want to
   change and save.
3. Click **Install**. When it clears, the shipped entities appear under their resolved
   ids on the Collections and Agents pages.

Via the CLI:

```
primectl create -f inbound.yaml
primectl call harness fetch <inbound-id>
primectl get harness <inbound-id> -o yaml      # poll until overrides_schema is set
primectl call harness overrides <inbound-id> -f overrides.yaml   # optional
primectl call harness install <inbound-id>
primectl get harness <inbound-id> -o yaml      # poll until status is installed
```

where `inbound.yaml` is:

```yaml
kind: harness
spec:
  slug: kb-pack-install
  name: KB Q&A pack (install)
  git_url: file:///srv/git/kb-pack.git
  ref: main
  direction: inbound
```

A few things worth knowing:

- **`tracked_entities` uses `source_id`** (the id of the live entity to ship) and
  `template_name` (its name in the bundle). Both are required for outbound.
- **`git_url` is mandatory at create**, even before you push - it is where the bundle
  goes. A local bare repo (`git init --bare`) is fine for testing.
- **Build and push are separate.** Build renders and leaves the harness in `draft`;
  only push writes to git. Re-running build after an entity changes updates the
  `bundle_hash`, and `commits_ahead` tells you a push is due.
- **Overrides are the install-time knobs.** Whatever the templatizer parameterized
  shows up in `overrides.schema.json`; the installing side fills it so the same pack
  can target different providers or ids.

## Testing

Point the harness at a throwaway bare repo:

```
git init --bare /srv/git/kb-pack.git
```

Then create, build, and push it (console buttons or the `primectl call harness` verbs
above) and inspect the result. Expected outcome (verified):

- After **build**, the harness has a non-null `bundle_hash` and no
  `last_operation_error`, still in status `draft`. Confirm on the detail page or with
  `primectl get harness <id> -o yaml`.
- After **push**, `last_pushed_commit` is set and the bare repo has a commit titled
  *"primer outbound: kb-pack @ <timestamp>"* on the `main` ref, containing
  `harness.yaml`, `overrides.schema.json`, and one `templates/<name>.yaml` per tracked
  entity.
- `git --git-dir=/srv/git/kb-pack.git ls-tree -r --name-only main` lists the bundle
  files; `git --git-dir=/srv/git/kb-pack.git show main:harness.yaml` shows the rendered
  manifest.

To prove the round trip, create an **inbound** harness against the same repo, install
it (console **Install** button or `primectl call harness install <id>`), and confirm
the `kb` collection and `kb-qa` agent appear under their resolved ids (`<slug>__kb`,
`<slug>__kb-qa`) on the Collections and Agents pages or via
`primectl get collection <slug>__kb`.
