---
slug: cookbook-self-improving-skill
title: Self-improving skill loop
section: cookbook
summary: "A background agent that watches for new results, grades them against a skill stored in a collection, and rewrites that skill to get better over time."
difficulty: advanced
time_minutes: 25
tags: ["watch-files", "knowledge", "self-improving", "yielding", "loop"]
---

## Goal

Keep a reusable **skill** (a prompt fragment or how-to) in a collection and let it
improve itself from real outcomes. A producer drops each finished result into a
file; an **evaluator** agent watches that file, grades how well the current skill
would have produced the result, rewrites the skill, and goes back to watching. The
skill gets measurably better over time with no human in the loop.

This recipe demonstrates `watch_files` (a yielding tool that parks a session at zero
cost until a file changes), reading and writing collection documents from inside an
agent, and a loop that runs forever.

## Ingredients

- **An LLM provider** (any chat model).
- **A collection** to hold the skill document(s).
- The **`workspace_ext`** toolset (for `watch_files`) and the **`system`** toolset
  (for `get_document_content` + `put_document`).
- **A workspace** with the `local` backend (the evaluator runs as a session in it;
  the producer writes results into the same workspace).
- A platform whose background **watcher** is healthy (see the note in step 4).

## Walkthrough

### 1. Create the skill collection and seed a skill

`system::create_collection`
```json
{
  "id": "skills",
  "description": "Reusable skills that improve over time from evaluation feedback.",
  "embedder": {"provider_id": "<your-embedder>", "model": "<your-embed-model>"},
  "search_provider_id": "<your-ssp>"
}
```

Seed one skill document (the content body is the request body; `path` is a query
parameter):

`PUT /v1/collections/skills/documents?path=support-reply.md`
```json
{"content": "# Support reply skill\n\nWhen replying to a support ticket:\n1. Greet the customer.\n2. Restate the problem.\n3. Give the fix steps.\n4. Offer further help."}
```

### 2. Create the evaluator agent

It binds `watch_files` plus the two document tools. The system prompt makes it loop.

`system::create_agent`
```json
{
  "id": "skill-evaluator",
  "description": "Watches a results file, grades it against a skill, and rewrites the skill to improve over time.",
  "model": {"provider_id": "<your-llm>", "model_name": "<your-model>"},
  "tools": ["workspace_ext__watch_files", "system__get_document_content", "system__put_document"],
  "max_tool_turns": 12,
  "system_prompt": ["You continuously improve a support-reply skill from real results. Repeat this loop: (1) call watch_files to wait for changes to the EXACT file path results/latest.md; (2) read results/latest.md (it is a support reply someone wrote); (3) read the current skill with get_document_content (collection_id skills, path support-reply.md); (4) judge how well that skill would have produced the reply, then write an IMPROVED version of the skill back with put_document (collection_id skills, path support-reply.md, content = the revised skill); (5) state in one line what you changed, then go back to step 1. Watch the specific file results/latest.md, not the directory."]
}
```

### 3. Run the evaluator

`workspaces::create_workspace_session`
```json
{
  "workspace_id": "<your-workspace>",
  "binding": {"kind": "agent", "agent_id": "skill-evaluator"},
  "initial_instructions": "Begin the watch loop.",
  "auto_start": true
}
```

The session runs one turn, calls `watch_files`, and **parks** (zero compute) waiting
for `results/latest.md`.

### 4. Feed it results

Whatever produces the work (another agent, a session, a script) writes each result
to the **exact** path the evaluator watches, `results/latest.md`, overwriting it each
time. On every write the evaluator wakes, grades the result, rewrites
`support-reply.md` in the `skills` collection, and parks again.

Three things that matter:

- **Watch a specific FILE path, not a directory.** `watch_files` matches the exact
  paths you pass. Watching `results/` will **not** fire for `results/foo.md` - watch
  `results/latest.md` and write that exact path. (Have the producer overwrite one
  known file, or watch the specific filenames you expect.)
- **The watched file's directory and the watcher are workspace-relative.** The
  producer must write inside the same workspace the evaluator runs in.
- **`watch_files` relies on the platform's background watcher** (a leader-elected
  task). If parked sessions never wake, check that your deployment's coordinator /
  leader election is healthy and that you are not exhausting the OS inotify instance
  limit with a large number of simultaneously-parked watch sessions.

## Testing

Seed the 4-step skill above, start the evaluator, then write a deliberately poor
reply:

`results/latest.md`:
> hey. is it broken? just restart it. bye.

Expected outcome (verified):

- The parked evaluator **wakes** within a second or two of the write.
- It reads the reply, reads `support-reply.md`, and **rewrites the skill** - the
  document's content changes (e.g. it grew from the 4-step list to a version with an
  added improvement note and a worked example, such as *"For urgent issues, add
  'Restarting now...' after greeting"*).
- Confirm by re-reading the document:
  `GET /v1/collections/skills/documents?path=support-reply.md` - its `content` now
  differs from the seed.
- Write a second, different reply and watch the skill evolve again - the loop keeps
  running.

To grade against a **library** of skills instead of one, give the evaluator
`search_collection` so it can find the most relevant skill for each result before
rewriting it.
