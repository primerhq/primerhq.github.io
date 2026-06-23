---
slug: cookbook-self-improving-skill
title: Self-improving skill loop
section: cookbook
summary: "A background agent that watches for new results, grades them against a skill stored in a collection, and rewrites that skill to get better over time, set up from the console or with the primectl CLI."
difficulty: advanced
time_minutes: 25
tags: ["watch-files", "knowledge", "self-improving", "yielding", "loop"]
---

## Goal

Keep a reusable **skill** (a prompt fragment or how-to) in a collection and let it
improve itself from real outcomes. A producer drops each finished result into a file;
an **evaluator** agent watches that file, grades how well the current skill would have
produced the result, rewrites the skill, and goes back to watching. The skill gets
measurably better over time with no human in the loop.

This recipe demonstrates `watch_files` (a yielding tool that parks a session at zero
cost until a file changes), reading and writing collection documents from inside an
agent, and a loop that runs forever. Each setup step is shown two ways: first **in the
console**, then **via the CLI**.

## Ingredients

- **An LLM provider** (any chat model).
- An **embedding provider** and a **semantic search provider** (a collection requires
  both at create).
- **A collection** to hold the skill document(s).
- The **`workspace_ext`** toolset (for `watch_files`) and the **`system`** toolset
  (for `get_document_content` + `put_document`).
- **A local workspace** (the evaluator runs as a session in it; the producer writes
  results into the same workspace).
- A platform whose background **watcher** is healthy (see the note in step 4).
- To drive the CLI path, point `primectl` at your instance once; see the one-time
  [Connecting the CLI](cookbook-rag-knowledge-base) block in the RAG recipe.

## Walkthrough

### 1. Create the skill collection and seed a skill

Create the embedding and semantic-search providers the same way the RAG recipe does,
then create the collection and seed one skill document.

In the console:

1. Go to **Knowledge > Collections**, click **New collection**, set **ID** to `skills`,
   pick your embedder and search provider, and click **Create**.
2. Go to **Knowledge > Documents**, choose the `skills` collection, click
   **New document**, set the **Path** to `support-reply.md`, paste the skill body
   (below), and click **Create**.

Via the CLI:

```
primectl create -f skills.yaml
primectl doc put skills support-reply.md --content "# Support reply skill

When replying to a support ticket:
1. Greet the customer.
2. Restate the problem.
3. Give the fix steps.
4. Offer further help."
```

where `skills.yaml` is:

```yaml
kind: collection
spec:
  id: skills
  description: Reusable skills that improve over time from evaluation feedback.
  embedder:
    provider_id: <embedder>
    model: <embed-model>
  search_provider_id: <ssp>
```

### 2. Create the evaluator agent

It binds `watch_files` plus the two document tools. The system prompt makes it loop.

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On the **Basic** tab set **ID** to `skill-evaluator`, add a **Description**, and pick
   the **LLM provider** and **Model**.
3. On the **Tools** tab check `workspace_ext__watch_files`,
   `system__get_document_content`, and `system__put_document`.
4. On the **Advanced** tab paste the system prompt (below). Click **Create**.

Via the CLI:

```
primectl create -f skill-evaluator.yaml
```

where `skill-evaluator.yaml` is:

```yaml
kind: agent
spec:
  id: skill-evaluator
  description: Watches a results file, grades it against a skill, and rewrites the skill.
  model:
    provider_id: <llm>
    model_name: <model>
  tools:
    - workspace_ext__watch_files
    - system__get_document_content
    - system__put_document
  max_tool_turns: 12
  system_prompt:
    - >-
      You continuously improve a support-reply skill from real results. Repeat this
      loop: (1) call watch_files to wait for changes to the EXACT file path
      results/latest.md; (2) read results/latest.md (it is a support reply someone
      wrote); (3) read the current skill with get_document_content (collection_id
      skills, path support-reply.md); (4) judge how well that skill would have
      produced the reply, then write an IMPROVED version of the skill back with
      put_document (collection_id skills, path support-reply.md, content = the
      revised skill); (5) state in one line what you changed, then go back to step 1.
      Watch the specific file results/latest.md, not the directory.
```

### 3. Run the evaluator

Start a session bound to the evaluator. It runs one turn, calls `watch_files`, and
**parks** (zero compute) waiting for `results/latest.md`.

In the console:

1. Click **New session**, set the **Binding** to `agent`, pick `skill-evaluator`,
   choose your **Workspace**, and type `Begin the watch loop.` into
   **Initial instructions**.
2. Click **Create**. On the Sessions page the session shows as parked once it calls
   `watch_files`.

Via the CLI (start it without watching to terminal, since it parks on purpose):

```
primectl session run <workspace-id> --agent skill-evaluator \
  -i "Begin the watch loop." --no-watch
```

### 4. Feed it results

Whatever produces the work (another agent, a session, a script) writes each result to
the **exact** path the evaluator watches, `results/latest.md`, overwriting it each time.
On every write the evaluator wakes, grades the result, rewrites `support-reply.md` in
the `skills` collection, and parks again.

There is no operator console button for this write - the producer is an upstream
process inside the same workspace. To exercise the wake yourself, write the file
directly:

```
primectl workspace files put <workspace-id> results/latest.md \
  --content "hey. is it broken? just restart it. bye."
```

Three things that matter:

- **Watch a specific FILE path, not a directory.** `watch_files` matches the exact
  paths you pass. Watching `results/` will **not** fire for `results/foo.md` - watch
  `results/latest.md` and write that exact path.
- **The watched file's directory and the watcher are workspace-relative.** The producer
  must write inside the same workspace the evaluator runs in.
- **`watch_files` relies on the platform's background watcher** (a leader-elected task).
  If parked sessions never wake, check that your deployment's coordinator / leader
  election is healthy and that you are not exhausting the OS inotify instance limit
  with a large number of simultaneously-parked watch sessions.

## Testing

Seed the 4-step skill above, start the evaluator, then write a deliberately poor reply
to `results/latest.md` (via `primectl workspace files put` as in step 4, or from your
producer process):

> hey. is it broken? just restart it. bye.

Expected outcome (verified):

- The parked evaluator **wakes** within a second or two of the write (its `turn_no`
  advances on the Sessions page).
- It reads the reply, reads `support-reply.md`, and **rewrites the skill** - the
  document's content changes from the seed (for example it grows from the 4-step list
  to a version with an added improvement note such as *"For urgent issues, add
  'Restarting now...' after the greeting"*).
- Confirm by re-reading the document: **Knowledge > Documents** on the `skills`
  collection, or `primectl doc get skills support-reply.md` - its content now differs
  from the seed.
- Write a second, different reply and watch the skill evolve again - the loop keeps
  running.

To grade against a **library** of skills instead of one, give the evaluator
`search_collection` so it can find the most relevant skill for each result before
rewriting it.
