---
slug: cookbook-compliance-sweep
title: Overnight compliance sweep
section: cookbook
summary: "A nightly graph that fans out one audit branch per service, survives an unreachable service, and ships a single posture report."
difficulty: advanced
time_minutes: 25
tags: ["graphs", "fan-out", "map", "triggers", "scheduled", "audit"]
---

## Goal

Every night, audit every in-scope service and ship one report. Fan out one
independent audit branch **per service**, run them concurrently, and aggregate the
results. The catch a real audit pipeline has to handle: one service being
unreachable must not sink the whole sweep. The branch that fails is recorded as
failed and the report still ships with every service that *was* reachable.

This recipe wires a **scheduled trigger** to a graph through a
**`graph_fresh_session`** subscription, fans out with **`fan_out: map`** (one
branch per list item), keeps the run alive with **`on_failure: collect`**, and
joins with **`fan_in`**.

## Ingredients

- **An LLM provider** (used only to enumerate the in-scope services).
- A way each branch audits a service. This recipe keeps the audit leg
  deterministic by computing a posture score with the built-in `misc::calculate`
  tool, so the whole fan-out runs without depending on a model. Swap in your real
  audit tool (or an agent that calls one) for production.
- A workspace, a scheduled trigger, and a `graph_fresh_session` subscription.

## Walkthrough

### 1. Create the scope-lister agent

The graph starts by naming the services to audit. The agent has
`response_format` set so its output is structured, and the map fan-out can read
the list off `nodes.list_scope.parsed.services`.

`system::create_agent`
```json
{"id": "scope-lister", "description": "Names the in-scope services for the nightly sweep.", "model": {"provider_id": "<llm>", "model_name": "<model>"}, "tools": [], "system_prompt": ["You output ONLY a JSON object of the services to audit, as {\"services\": [{\"name\": \"...\", \"expr\": \"...\"}]}. Each `expr` is the service's posture-score check."]}
```

In production this agent reads your service catalog. Here, fix the list so the
sweep is reproducible: `billing-api` (`90 + 5`), `auth-svc` (`80 + 8`),
`payments-legacy` (`1 / 0`), `search-svc` (`70 + 9`). The `payments-legacy`
check divides by zero on purpose: that is the unreachable service.

### 2. Create the compliance-sweep graph

`begin` to `list_scope` (agent) to `fan` (the map fan-out) to `audit` (one
tool_call per service) to `report` (fan_in) to `end`.

`system::create_graph`
```json
{
  "id": "compliance-sweep",
  "description": "Nightly fan-out audit that survives a failing branch.",
  "max_iterations": 20,
  "nodes": [
    {"kind": "begin", "id": "begin"},
    {"kind": "agent", "id": "list_scope", "agent_id": "scope-lister", "input_template": "List the services to audit.", "response_format": {"type": "object", "required": ["services"], "properties": {"services": {"type": "array", "items": {"type": "object", "required": ["name", "expr"], "properties": {"name": {"type": "string"}, "expr": {"type": "string"}}}}}}},
    {"kind": "fan_out", "id": "fan", "specs": [{"kind": "map", "target_node_id": "audit", "source_node_id": "list_scope", "source_path": "services", "on_failure": "collect"}]},
    {"kind": "tool_call", "id": "audit", "tool_id": "misc__calculate", "arguments_template": "{\"expression\": \"{{ fanout_item.expr }}\"}", "output_schema": {"type": "object", "required": ["expression", "result"], "properties": {"expression": {"type": "string"}, "result": {"type": "number"}}}},
    {"kind": "fan_in", "id": "report", "aggregate_template": "COMPLIANCE POSTURE REPORT\n{% for r in nodes.audit %}service #{{ loop.index0 }}: {% if r.error %}FAILED ({{ r.ended_detail }}){% else %}OK score={{ r.parsed.result }}{% endif %}\n{% endfor %}"},
    {"kind": "end", "id": "end", "output_template": "{{ nodes.report.text }}"}
  ],
  "edges": [
    {"kind": "static", "from_node": "begin", "to_node": "list_scope"},
    {"kind": "static", "from_node": "list_scope", "to_node": "fan"},
    {"kind": "static", "from_node": "audit", "to_node": "report"},
    {"kind": "static", "from_node": "report", "to_node": "end"}
  ]
}
```

Four things that decide whether this graph runs the way you expect:

- **`map` spawns one branch per list item.** The `fan` node reads the list at
  `source_node_id.parsed.source_path` (`list_scope.parsed.services`) and runs one
  `audit` instance per element. Each instance is its own node, `audit[0]`,
  `audit[1]`, ..., with isolated state. Inside `audit` you read the element with
  `{{ fanout_item.expr }}` (and the position with `{{ fanout_index }}`).
- **The fan_out spec does the dispatch; you wire only the join.** There is **no**
  `fan -> audit` edge (the spec spawns the branches). You **do** add
  `audit -> report` so the fan_in fires once every branch has produced output.
- **`on_failure: collect` is what keeps the sweep alive.** Without it, the first
  failing branch ends the whole graph (the default is `fail_fast`). With
  `collect`, a failed branch leaves an error-stamped entry in `nodes.audit`
  (its `.error` and `.ended_detail` are set, its `.text` is empty) and the graph
  keeps going. The `output_schema` on the `audit` node is what *marks* the
  unreachable branch failed: a healthy check returns `{"expression", "result"}`
  (conforms), while the `1 / 0` check returns an error string that does not, so
  that branch ends `tool_output_invalid` and is collected.
- **`fan_in` aggregates the list.** `nodes.audit` is a `list` aligned by branch
  index, so the report template loops it and branches on `r.error` to print
  either the score or a `FAILED` marker. The fan_in waits for **all** branches,
  including the collected failure, before it fires.

### 3. Schedule it

Create a scheduled trigger and point a `graph_fresh_session` subscription at the
graph. On each fire the rendered payload is parsed as JSON and handed to the
graph as its `graph_input`; the subscription spins up a fresh graph session in
the workspace.

`system::create_trigger`
```json
{"slug": "nightly-compliance", "name": "Nightly compliance sweep", "config": {"kind": "scheduled", "cron": "0 2 * * *", "timezone": "Asia/Dubai", "catchup": "none"}, "enabled": true}
```

`system::create_subscription`
```json
{"config": {"kind": "graph_fresh_session", "workspace_id": "<workspace>", "graph_id": "compliance-sweep"}, "payload_template": "{\"run\": \"nightly\"}", "parallelism": "skip"}
```

`parallelism: "skip"` declines a fire while a previous sweep is still running, so
a slow night never stacks overlapping sweeps. The session the dispatcher creates
is tagged with `metadata.subscription_id`, so you can find every run of this
subscription later.

## Testing

You do not have to wait for 02:00. Fire the trigger by hand:

`POST /v1/triggers/<id>/fire_now`

The fire response carries the dispatched session id. Poll
`GET /v1/sessions/<id>` until it ends.

Expected outcome (verified):

- The fired graph session ends `completed` **even though one branch failed** -
  that is the `collect` proof at the session level. The on-disk graph state
  (`.state/graphs/<sid>/state.json`) records `ended_reason: "completed"`.
- The `map` dispatched one branch per service: `nodes.audit` is a four-element
  list and the graph state has `audit[0]` through `audit[3]`, each with its own
  isolated node directory under `.state/graphs/<sid>/nodes/`.
- Exactly the unreachable service is collected: `audit[2]` ends `failed` with
  `tool_output_invalid`; the other three end `ended`. The graph still completes.
- The fan_in report ships every service:

  ```
  COMPLIANCE POSTURE REPORT
  service #0: OK score=95
  service #1: OK score=88
  service #2: FAILED (tool_output_invalid)
  service #3: OK score=79
  ```

To make a branch fail in your own sweep, give the audit step an `output_schema`
and have the audit return something that does not conform when the service is
unreachable (an error string, a partial object) - the node ends
`tool_output_invalid` and `collect` records it without sinking the run.
