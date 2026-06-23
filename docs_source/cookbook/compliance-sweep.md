---
slug: cookbook-compliance-sweep
title: Overnight compliance sweep
section: cookbook
summary: "A nightly graph that fans out one audit branch per service, survives an unreachable service, and ships a single posture report. Built in the console or with primectl."
difficulty: advanced
time_minutes: 25
tags: ["graphs", "fan-out", "map", "triggers", "scheduled", "audit"]
---

## Goal

Every night, audit every in-scope service and ship one report. Fan out one
independent audit branch **per service**, run them concurrently, and aggregate
the results. The catch a real audit pipeline has to handle: one service being
unreachable must not sink the whole sweep. The branch that fails is recorded as
failed and the report still ships with every service that *was* reachable.

This recipe wires a **scheduled trigger** to a graph through a
**`graph_fresh_session`** subscription, fans out with **`fan_out: map`** (one
branch per list item), keeps the run alive with **`on_failure: collect`**, and
joins with **`fan_in`**. As with the other recipes, each step is shown **in the
console** first, then **Via the CLI**; for the graph the editor's **Import spec**
paste and the `primectl create graph -f` manifest describe the same spec.

## Ingredients

- **An LLM provider** (used only to enumerate the in-scope services).
- A way each branch audits a service. This recipe keeps the audit leg
  deterministic by computing a posture score with the built-in `misc__calculate`
  tool, so the whole fan-out runs without depending on a model. Swap in your real
  audit tool (or an agent that calls one) for production.
- A workspace, a scheduled trigger, and a `graph_fresh_session` subscription.

If you have not connected `primectl` yet, see "Connecting the CLI" in the
[RAG knowledge base](cookbook-rag-knowledge-base) recipe.

## Walkthrough

### 1. Create the scope-lister agent

The graph starts by naming the services to audit. The agent has
`response_format` set so its output is structured, and the map fan-out can read
the list off `nodes.list_scope.parsed.services`.

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On **Basic** set **ID** to `scope-lister` and pick the **LLM provider** +
   **Model**; leave **Tools** empty; on **Advanced** paste the system prompt
   (below). Click **Create**.

Via the CLI:

```
primectl create -f scope-lister.yaml
```

```yaml
kind: agent
spec:
  id: scope-lister
  description: Names the in-scope services for the nightly sweep.
  model: { provider_id: <llm>, model_name: <model> }
  tools: []
  system_prompt:
    - >-
      You output ONLY a JSON object of the services to audit, as
      {"services": [{"name": "...", "expr": "..."}]}. Each expr is the service's
      posture-score check.
```

In production this agent reads your service catalog. Here, fix the list so the
sweep is reproducible: `billing-api` (`90 + 5`), `auth-svc` (`80 + 8`),
`payments-legacy` (`1 / 0`), `search-svc` (`70 + 9`). The `payments-legacy`
check divides by zero on purpose: that is the unreachable service.

### 2. Create the compliance-sweep graph

`begin` to `list_scope` (agent) to `fan` (the map fan-out) to `audit` (one
tool_call per service) to `report` (fan_in) to `end`.

In the console:

1. Go to **Compute > Graphs** and click **New graph**, give it the **ID**
   `compliance-sweep`, pick any **Seed agent**, and click **Create** to open the
   visual editor.
2. The fastest way to build the exact graph below is **Import spec**: paste the
   JSON from the manifest's `spec` and click **Load into editor**, then
   **Save**.
3. Or build it node by node with **Add node**: a **Begin**, an **Agent**
   (`scope-lister`, with its `response_format`), a **Fan-out** (set its mode to
   **map** with `source_node_id` `list_scope`, `source_path` `services`, target
   `audit`, and `on_failure` **collect**), a **Tool-call** node (`audit`, tool
   `misc__calculate`, with the `arguments_template` and `output_schema`), a
   **Fan-in** (`report`, with the `aggregate_template`), and an **End**. Wire
   `begin -> list_scope`, `list_scope -> fan`, `audit -> report`,
   `report -> end` with **Add edge** in **Static** mode (the fan-out spec
   spawns the `audit` branches, so there is no `fan -> audit` edge). Click
   **Save**.

Via the CLI:

```
primectl create -f compliance-graph.yaml
```

```yaml
kind: graph
spec:
  id: compliance-sweep
  description: Nightly fan-out audit that survives a failing branch.
  max_iterations: 20
  nodes:
    - { kind: begin, id: begin }
    - kind: agent
      id: list_scope
      agent_id: scope-lister
      input_template: "List the services to audit."
      response_format: { type: object, required: [services], properties: { services: { type: array, items: { type: object, required: [name, expr], properties: { name: { type: string }, expr: { type: string } } } } } }
    - kind: fan_out
      id: fan
      specs:
        - { kind: map, target_node_id: audit, source_node_id: list_scope, source_path: services, on_failure: collect }
    - kind: tool_call
      id: audit
      tool_id: misc__calculate
      arguments_template: '{"expression": "{{ fanout_item.expr }}"}'
      output_schema: { type: object, required: [expression, result], properties: { expression: { type: string }, result: { type: number } } }
    - kind: fan_in
      id: report
      aggregate_template: "COMPLIANCE POSTURE REPORT\n{% for r in nodes.audit %}service #{{ loop.index0 }}: {% if r.error %}FAILED ({{ r.ended_detail }}){% else %}OK score={{ r.parsed.result }}{% endif %}\n{% endfor %}"
    - { kind: end, id: end, output_template: "{{ nodes.report.text }}" }
  edges:
    - { kind: static, from_node: begin, to_node: list_scope }
    - { kind: static, from_node: list_scope, to_node: fan }
    - { kind: static, from_node: audit, to_node: report }
    - { kind: static, from_node: report, to_node: end }
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

In the console:

1. Go to **Automation > Triggers** and click **New trigger**. Set the **Kind**
   to **Scheduled**, give it a slug (`nightly-compliance`), set the **Cron** to
   `0 2 * * *` and the **Timezone**, leave **Catchup** at `none`, and **Enable**
   it. Click **Create**.
2. Open the trigger and click **New subscription**. Set the **Action** to
   **graph_fresh_session**, pick the `compliance-sweep` graph and the workspace,
   set the **Payload template** to `{"run": "nightly"}`, and set **Parallelism**
   to **skip**. Click **Create**.

Via the CLI:

```
primectl create -f trigger.yaml
```

```yaml
kind: trigger
spec:
  slug: nightly-compliance
  name: Nightly compliance sweep
  config: { kind: scheduled, cron: "0 2 * * *", timezone: Asia/Dubai, catchup: none }
  enabled: true
```

The subscription is nested under the trigger, so create it with the
`call trigger subscriptions` custom operation (pass the trigger id `create`
echoed back):

```
primectl call trigger subscriptions <trigger-id> -f subscription.yaml
```

```yaml
config: { kind: graph_fresh_session, graph_id: compliance-sweep, workspace_id: <workspace> }
payload_template: '{"run": "nightly"}'
parallelism: skip
```

`parallelism: skip` declines a fire while a previous sweep is still running, so
a slow night never stacks overlapping sweeps. The session the dispatcher creates
is tagged with `metadata.subscription_id`, so you can find every run of this
subscription later.

## Testing

You do not have to wait for 02:00. Fire the trigger by hand.

In the console, open the trigger and click **Fire now**; the fire result lists
the dispatched session, which you can open from the Sessions page.

Via the CLI, fire it with the `fire-now` custom operation and read the
dispatched session id off the result:

```
primectl call trigger fire-now <trigger-id> -f empty.json
```

where `empty.json` is `{}`. The fire result's `results[].artefact_id` is the
dispatched graph session id; poll it to terminal with
`primectl get session <session-id> -o json -r`.

Expected outcome (verified):

- The fired graph session ends `completed` **even though one branch failed** -
  that is the `collect` proof at the session level. The on-disk graph state
  records `ended_reason: "completed"`.
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

You can read the report back through the workspace file API with
`primectl workspace files get <workspace-id> .state/sessions/<sid>/messages.jsonl --content`,
and the per-branch graph state from `.state/graphs/<sid>/state.json`.

To make a branch fail in your own sweep, give the audit step an `output_schema`
and have the audit return something that does not conform when the service is
unreachable (an error string, a partial object); the node ends
`tool_output_invalid` and `collect` records it without sinking the run.
