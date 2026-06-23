---
slug: cookbook-app-builder
title: Describe-to-deploy app builder
section: cookbook
summary: "One plain-English ask, and a builder agent provisions a whole mini-app - a collection, a seeded doc, an agent, a graph, and a scheduled trigger - through the internal CRUD tools, set up entirely from the console or with the primectl CLI."
difficulty: advanced
time_minutes: 25
tags: ["agents", "crud", "graphs", "triggers", "dynamic"]
---

## Goal

Describe an app in one sentence ("build me a nightly news-digest bot that reads my
docs and posts a summary") and have an **app-builder** agent assemble every backing
entity for you. Where the [meta-agent recipe](cookbook-meta-agent-builder) creates a
single agent, this recipe exercises the rest of the platform's **internal CRUD
toolsets**: the agent creates a collection, seeds a document, creates an agent, creates
a graph, and creates a scheduled trigger with a subscription, then **fires the trigger
once** so the assembled app actually runs end to end.

The important shift for the operator: you do not click through six create forms. You
create the builder agent once and start one session, and the **agent** does the CRUD
at runtime by calling the same `system` and `trigger` tools any agent can call. Each
setup step below is shown two ways: first **in the console**, then **via the CLI**.

## Ingredients

- **An LLM provider** for the builder agent (and one for any agent it creates).
- An **embedding provider** and a **semantic search provider** so the collection it
  builds is real and searchable.
- The **`system`** CRUD toolset, specifically:
  - `system__create_collection` and `system__put_document` (a searchable KB);
  - `system__create_agent` (the worker agent the app runs);
  - `system__create_graph` (a runnable `begin -> agent -> end` workflow).
- The always-on **`trigger`** toolset:
  - `trigger__create` (a `scheduled` trigger);
  - `trigger__create_subscription` (a `graph_fresh_session` subscription pointing at
    the new graph);
  - `trigger__fire_now` (fire the assembled app once to prove it runs).
- A **local workspace** for the builder session.
- To drive the CLI path, point `primectl` at your instance once; see the one-time
  [Connecting the CLI](cookbook-rag-knowledge-base) block in the RAG recipe.

All of those are callable agent tools. `trigger` is an always-on reserved toolset
(alongside `system`, `misc`, and `workspaces`), so `trigger__create`,
`trigger__create_subscription`, and `trigger__fire_now` are available to any agent that
lists them in its `tools`.

## Walkthrough

### 1. Create the app-builder agent

This is the only entity you author by hand. List every CRUD tool it needs and a system
prompt that tells it the assembly order.

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On the **Basic** tab set **ID** to `app-builder`, add a **Description**, and pick
   the **LLM provider** and **Model**.
3. On the **Tools** tab check `system__create_collection`, `system__put_document`,
   `system__create_agent`, `system__create_graph`, `trigger__create`,
   `trigger__create_subscription`, and `trigger__fire_now`.
4. On the **Advanced** tab set **Max tool turns** to 12 and paste the system prompt
   (below). Click **Create**.

Via the CLI:

```
primectl create -f app-builder.yaml
```

where `app-builder.yaml` is:

```yaml
kind: agent
spec:
  id: app-builder
  description: Provisions a whole mini-app from one request using the CRUD tools.
  model:
    provider_id: <llm>
    model_name: <model>
  tools:
    - system__create_collection
    - system__put_document
    - system__create_agent
    - system__create_graph
    - trigger__create
    - trigger__create_subscription
    - trigger__fire_now
  max_tool_turns: 12
  system_prompt:
    - >-
      You build a whole mini-app from one request. Given the ask: (1) create the
      collection (with an embedder and a search_provider_id); (2) seed one document
      with put_document; (3) create the worker agent the app runs; (4) create the
      graph that wires that agent into a begin -> agent -> end workflow; (5) create a
      scheduled trigger and a graph_fresh_session subscription pointing at the new
      graph. Report each id you created.
```

### 2. Run the builder with the app description

Start a session bound to the builder agent and pass the one-line app description as the
instruction. The agent calls one CRUD tool per turn and assembles the whole app.

In the console:

1. Click **New session** (top right of the dashboard or the Sessions page).
2. Set the **Binding** to `agent`, pick `app-builder`, choose a **Workspace**, and type
   the app description into **Initial instructions**.
3. Click **Create** and watch the transcript: the agent calls `create_collection`,
   `put_document`, `create_agent`, `create_graph`, then `trigger__create` in order.

Via the CLI:

```
primectl session run <workspace-id> --agent app-builder \
  -i "Build a nightly news-digest app: create the collection, seed a doc, create the summarizer agent, create the digest graph, and create a scheduled trigger."
```

`session run` creates the session, polls it to completion, and prints the progress.
(If you do not have a workspace yet, create a local one as the RAG recipe shows:
`primectl create -f workspace_provider.yaml`, a matching `workspace_template`, then
`primectl create workspace --set template_id=<tpl>`.)

The builder calls one CRUD tool per turn:

1. `system__create_collection` - the KB, with an `embedder` and a `search_provider_id`.
2. `system__put_document` - seed a doc at a path; with search on, the write is indexed
   so the doc is immediately searchable.
3. `system__create_agent` - the worker agent (a summarizer here), pointed at its own
   LLM provider and model.
4. `system__create_graph` - a `begin -> agent -> end` graph whose `agent` node runs the
   worker, with an `end` node that renders the result.
5. `trigger__create` - a `scheduled` trigger (a cron the scheduler honours).
6. `trigger__create_subscription` - a `graph_fresh_session` subscription whose
   `graph_id` is the new graph and whose `workspace_id` is where it runs.

### 3. Fire it once to prove it runs

The builder's last step (or yours) fires the trigger once so the assembled app runs
immediately, bypassing the scheduler.

In the console:

1. Go to **Triggers**, open the trigger the builder created, and click **Fire now**.
2. The `graph_fresh_session` subscriber renders its `payload_template`, uses it as the
   graph input, and spins up a fresh graph session. Open it on the Sessions page and
   watch the digest workflow run to `completed`.

Via the CLI:

```
primectl call trigger fire-now <trigger-id>
primectl get session <dispatched-session-id> -o yaml   # poll to terminal
```

`fire_now` returns the dispatched session id in its `results` (the per-subscription
`artefact_id`), so you can poll that session to a terminal state.

A few things worth knowing:

- **Each `create_*` result echoes the whole entity.** When you sequence the builder's
  steps yourself (in a script or a graph), key the next step on a token unique to the
  previous result - otherwise an earlier step can re-match a later result.
- **Collections need an embedder and a search provider at create.** `search_provider_id`
  is bound at create and immutable thereafter, so the builder must supply it up front.
- **The worker agent needs its own LLM provider.** The agent the builder creates runs
  inside the fired graph; give it a real `provider_id`/`model_name` (its own, not the
  builder's) so its node turn produces output.
- **The subscription kind matches what you fire.** A graph app uses
  `graph_fresh_session`; a single-agent app uses `agent_fresh_session`. Both render
  `payload_template` into the new session's input.

## Testing

> "Build a nightly news-digest app: create the collection, seed a doc, create the
> summarizer agent, create the digest graph, and create a scheduled trigger."

Expected outcome (verified):

- The builder calls the CRUD tools in assembly order and finishes `completed`. Watch
  the transcript on the Sessions page, or read `ended: completed` from `session run`.
- Each entity it created **persists**: it shows up on the Collections, Agents,
  Graphs, and Triggers pages, or via `primectl get collection <id>`,
  `primectl get agent <id>`, `primectl get graph <id>`, and `primectl get trigger <id>`.
- The seeded document is **searchable**: use **Search** on the collection detail page,
  or `primectl call collection search <id> -f query.json` where `query.json` is
  `{"query": "channel media pipeline", "top_k": 5}`.
- Firing the trigger once **runs the app**: the dispatched graph session reaches
  terminal `completed` and writes a real transcript - proof the assembled app is
  runnable, not just defined.

Try other one-line asks ("a support bot that answers from these FAQs", "a weekly
report graph over this collection") and watch the builder wire up the matching
collection, agent, graph, and trigger each time.
