---
slug: cookbook-harness-packaging
title: Package and ship entities as a harness
section: cookbook
summary: "Bundle a set of agents, collections, and graphs into a versioned harness, push it to a git repo, and install it into another primer."
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
primer entities".

## Ingredients

- **A git repo** the harness can push to (any URL the server can reach; this recipe
  uses a local bare repo).
- The entities you want to ship - here the `kb` collection and `kb-qa` agent from the
  [RAG knowledge base](cookbook-rag-knowledge-base) recipe.

## Walkthrough

### 1. Create an outbound harness

List the entities to ship as `tracked_entities`. Each names the source entity by
`source_id` and the `template_name` it gets in the bundle. `git_url` is required - it
is the push target.

`POST /v1/harnesses`
```json
{
  "slug": "kb-pack",
  "name": "KB Q&A pack",
  "description": "Reusable IT-support KB + Q&A agent.",
  "git_url": "file:///srv/git/kb-pack.git",
  "direction": "outbound",
  "tracked_entities": [
    {"kind": "collection", "template_name": "kb", "source_id": "kb"},
    {"kind": "agent", "template_name": "kb-qa", "source_id": "kb-qa"}
  ]
}
```

### 2. Build, then push

**Build** templatizes the tracked entities into a bundle (computes a `bundle_hash`);
**push** commits that bundle to git. Both are asynchronous (the server enqueues them
on its claim engine and returns `202`); poll the harness until `pending_operation`
clears.

```
POST /v1/harnesses/{id}/build     # renders the bundle; status stays "draft"
POST /v1/harnesses/{id}/push      # commits to git; records last_pushed_commit
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
then fetch and install. Install materializes the templates as real entities; supply
`overrides` for anything the bundle parameterized (ids, provider ids, models).

```
POST /v1/harnesses                      # direction: "inbound", git_url, ref
POST /v1/harnesses/{id}/fetch           # pull the bundle from git
PUT  /v1/harnesses/{id}/overrides       # optional: fill the overrides schema
POST /v1/harnesses/{id}/install         # create the entities locally
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

Then create → build → push and inspect the result. Expected outcome (verified):

- After **build**, the harness has a non-null `bundle_hash` and
  `last_operation_error: null`, still in status `draft`.
- After **push**, `last_pushed_commit` is set and the bare repo has a commit titled
  *"primer outbound: kb-pack @ <timestamp>"* on the `main` ref, containing
  `harness.yaml`, `overrides.schema.json`, and one `templates/<name>.yaml` per tracked
  entity.
- `git --git-dir=/srv/git/kb-pack.git ls-tree -r --name-only main` lists the bundle
  files; `git show main:harness.yaml` shows the rendered manifest.

To prove the round trip, create an **inbound** harness on a second primer against the
same repo, install it, and confirm the `kb` collection and `kb-qa` agent appear there.
