---
slug: cookbook-app-builder
title: Describe-to-deploy app builder
section: cookbook
summary: "One plain-English ask, and a builder agent provisions a whole mini-app - a collection, a seeded doc, an agent, a graph, and a scheduled trigger - through the internal CRUD tools, then fires it once to prove it runs."
difficulty: advanced
time_minutes: 25
tags: ["agents", "crud", "graphs", "triggers", "dynamic"]
---

## Goal

Describe an app in one sentence ("build me a nightly news-digest bot that reads my
docs and posts a summary") and have an **app-builder** agent assemble every backing
entity for you. Where the [meta-agent recipe](cookbook-meta-agent-builder) creates a
single agent, this recipe exercises the rest of the platform's **internal CRUD
toolsets**: it creates a collection, seeds a document, creates an agent, creates a
graph, and creates a scheduled trigger with a subscription - then **fires the trigger
once** so the assembled app actually runs end to end, not just sits there defined.

This is the canonical "provision a whole app from a prompt" pattern. The builder never
touches the REST API directly; it drives the same `system` and `trigger` tools any
agent can call.

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

All of these are callable agent tools. The trigger leg is fully supported: `trigger`
is an always-on reserved toolset (alongside `system`, `misc`, and `workspaces`), so
`trigger__create`, `trigger__create_subscription`, and `trigger__fire_now` are
available to any agent that lists them in its `tools`.

## Walkthrough

### Create the app-builder agent

`system::create_agent`
```json
{
  "id": "app-builder",
  "description": "Provisions a whole mini-app from one request using the CRUD tools.",
  "model": {"provider_id": "<llm>", "model_name": "<model>"},
  "tools": [
    "system__create_collection",
    "system__put_document",
    "system__create_agent",
    "system__create_graph",
    "trigger__create",
    "trigger__create_subscription",
    "trigger__fire_now"
  ],
  "max_tool_turns": 12,
  "system_prompt": ["You build a whole mini-app from one request. Given the ask: (1) create the collection (with an embedder and a search_provider_id); (2) seed one document with put_document; (3) create the worker agent that the app runs; (4) create the graph that wires that agent into a begin -> agent -> end workflow; (5) create a scheduled trigger and a graph_fresh_session subscription pointing at the new graph. Report each id you created."]
}
```

Run it with the app description as the instruction (a workspace session, or fire it
from a trigger):

```
Build a nightly news-digest app: create the collection, seed a doc, create the
summarizer agent, create the digest graph, and create a scheduled trigger.
```

The builder calls one CRUD tool per turn:

1. `system__create_collection` - the KB, with an `embedder` and a `search_provider_id`.
2. `system__put_document` - seed a doc at a path; with search on, the write is
   indexed so the doc is immediately searchable.
3. `system__create_agent` - the worker agent (a summarizer here), pointed at its own
   LLM provider and model.
4. `system__create_graph` - a `begin -> agent -> end` graph whose `agent` node runs
   the worker, with an `end` node that renders the result.
5. `trigger__create` - a `scheduled` trigger (a cron the scheduler honours).
6. `trigger__create_subscription` - a `graph_fresh_session` subscription whose
   `graph_id` is the new graph and whose `workspace_id` is where it runs.

### Fire it once to prove it runs

`trigger::fire_now`
```json
{ "id": "<trigger id>" }
```

`fire_now` bypasses the scheduler and dispatches the subscription immediately. The
`graph_fresh_session` subscriber renders the subscription's `payload_template` to a
JSON object, uses it as the graph input, and spins up a fresh graph session that runs
the digest workflow to completion.

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
- **`fire_now` returns the dispatched session id** in its `results` (the per-
  subscription `artefact_id`), so the builder - or you - can poll that session to a
  terminal state.

## Testing

> "Build a nightly news-digest app: create the collection, seed a doc, create the
> summarizer agent, create the digest graph, and create a scheduled trigger."

Expected outcome (verified):

- The builder calls the CRUD tools in assembly order and finishes `completed`.
- Each entity it created **persists**: `GET /v1/collections/<id>`, `/v1/agents/<id>`,
  `/v1/graphs/<id>`, and the trigger under `GET /v1/triggers` all return it.
- The seeded document is **searchable**: `POST /v1/collections/<id>/search` returns a
  hit on the seeded text.
- Firing the trigger once **runs the app**: the dispatched graph session reaches
  terminal `completed` and writes a real transcript - proof the assembled app is
  runnable, not just defined.

Try other one-line asks ("a support bot that answers from these FAQs", "a weekly
report graph over this collection") and watch the builder wire up the matching
collection, agent, graph, and trigger each time.
