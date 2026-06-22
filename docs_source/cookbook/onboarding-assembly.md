---
slug: cookbook-onboarding-assembly
title: New-customer onboarding assembly
section: cookbook
summary: "Compose reusable child graphs as subgraph nodes, broadcast one across several regions, and kick the whole assembly off from a single agent with invoke_graph."
difficulty: advanced
time_minutes: 30
tags: ["graphs", "subgraph", "composition", "fan-out", "broadcast", "invoke_graph"]
---

## Goal

Onboarding a new customer is the same handful of steps every time: verify the
customer (KYC), provision their account, then stand up a regional footprint in
each region you serve. Rather than copy those steps into every workflow, build
each as its own small graph **once** and **compose** them.

This recipe assembles three reusable child graphs into one parent:

- `kyc-check` and `provision-account` run **in sequence** as **`kind: graph`
  (subgraph) nodes**.
- `provision-region` is **broadcast across several regions** with a
  **`fan_out: broadcast` OVER a subgraph** target, so the same child graph runs
  N times in parallel, each with isolated state.
- A coordinator agent kicks the whole thing off from a single instruction using
  the **`workspace_ext::invoke_graph`** tool, and gets the rolled-up result back.

The headline mechanic is **subgraph composition**: a child graph's output flows
into the parent (`nodes.<child>.text`), a failing child fails the parent instead
of being silently skipped, and a broadcast over a subgraph gives every instance
its own nested run.

## Ingredients

- **An LLM provider** for the agent inside each child graph (in this recipe each
  child graph is `begin -> agent -> end`; the agent does the actual KYC /
  provisioning work). The composition mechanics are model-independent, so you can
  pin each agent's output for a reproducible run.
- A workspace.
- No triggers or subscriptions: the coordinator agent starts the assembly itself
  with `invoke_graph`.

## Walkthrough

### 1. Build the three reusable child graphs

Each is a tiny `begin -> agent -> end` graph. The agent does the work; the `end`
node exposes the agent's text as the child graph's output. Keep them generic so
the same graph slots into any parent.

`system::create_graph` (kyc-check)
```json
{
  "id": "kyc-check",
  "description": "Verify a new customer's identity.",
  "max_iterations": 10,
  "nodes": [
    {"kind": "begin", "id": "begin"},
    {"kind": "agent", "id": "work", "agent_id": "kyc-agent", "input_template": "{{ initial_input }}"},
    {"kind": "end", "id": "end", "output_template": "{{ nodes.work.text }}"}
  ],
  "edges": [
    {"kind": "static", "from_node": "begin", "to_node": "work"},
    {"kind": "static", "from_node": "work", "to_node": "end"}
  ]
}
```

Create `provision-account` and `provision-region` the same way (swap the agent
and the id). The only thing that matters for composition is that each child's
`end` node renders the output you want the parent to see: that text is what the
parent reads off `nodes.<child>.text`.

### 2. Assemble the parent graph

The parent references each child by id as a `kind: graph` node, chains the two
sequential ones, then fans the region child out with a `broadcast` spec.

`system::create_graph` (onboarding-assembly)
```json
{
  "id": "onboarding-assembly",
  "description": "Compose KYC + account provisioning, then a regional footprint.",
  "max_iterations": 30,
  "nodes": [
    {"kind": "begin", "id": "begin"},
    {"kind": "graph", "id": "kyc", "graph_id": "kyc-check", "input_template": "Customer: {{ initial_input }}"},
    {"kind": "graph", "id": "provision", "graph_id": "provision-account", "input_template": "Provision for {{ initial_input }}"},
    {"kind": "fan_out", "id": "regions", "specs": [{"kind": "broadcast", "target_node_id": "region", "count": 3}]},
    {"kind": "graph", "id": "region", "graph_id": "provision-region", "input_template": "Provision region #{{ fanout_index }}"},
    {"kind": "fan_in", "id": "rollup", "aggregate_template": "{% for r in nodes.region %}region #{{ loop.index0 }}: {{ r.text }}\n{% endfor %}"},
    {"kind": "end", "id": "end", "output_template": "KYC={{ nodes.kyc.text }} | PROV={{ nodes.provision.text }}\n{{ nodes.rollup.text }}"}
  ],
  "edges": [
    {"kind": "static", "from_node": "begin", "to_node": "kyc"},
    {"kind": "static", "from_node": "kyc", "to_node": "provision"},
    {"kind": "static", "from_node": "provision", "to_node": "regions"},
    {"kind": "static", "from_node": "region", "to_node": "rollup"},
    {"kind": "static", "from_node": "rollup", "to_node": "end"}
  ]
}
```

Five things that decide whether the composition runs the way you expect:

- **A `kind: graph` node runs a whole child graph and hands its End output up.**
  Inside the parent, `nodes.kyc.text` is the `kyc-check` graph's `end` output
  (and `nodes.kyc.parsed` is its parsed object when the child's `end` produced
  one). The parent's `end` template weaves the two sequential children together.
  The child's output is captured from its End node, **not** reconstructed from a
  streamed text guess, so it is never silently empty.
- **`broadcast` over a subgraph runs the child N times.** The `regions` fan-out
  spawns `region[0]`, `region[1]`, `region[2]`, each a full `provision-region`
  run. Inside the `region` node's `input_template` you read the instance index
  with `{{ fanout_index }}`. There is **no** `regions -> region` edge: the
  fan-out spec does the dispatch.
- **Each broadcast instance gets its own isolated nested run.** A subgraph node
  that is a fan-out instance runs under its own state subtree (`region[0]`,
  `region[1]`, ...), so the three concurrent region runs never collide on one
  shared checkpoint. `nodes.region` is a `list` aligned by instance index.
- **The fan_in joins the list.** `nodes.region` is a list, so the `rollup`
  template loops it. The fan_in waits for **all** instances before it fires; you
  wire the join with the `region -> rollup` edge.
- **A failing child fails the parent.** If a child graph ends `failed` (a bad
  template, a tool error, a node that fails), the parent's subgraph node ends
  `failed` too and the parent does not advance past it. Composition does not
  swallow a broken child.

### 3. Kick it off from a coordinator agent

The coordinator runs the whole assembly inside its own session with
`workspace_ext::invoke_graph` and gets the graph's output back as the tool
result, so a single agent instruction drives the entire onboarding.

`system::create_agent` (onboarding-coordinator)
```json
{"id": "onboarding-coordinator", "description": "Kicks off the onboarding assembly.", "model": {"provider_id": "<llm>", "model_name": "<model>"}, "tools": ["workspace_ext__invoke_graph"], "system_prompt": ["When asked to onboard a customer, call workspace_ext__invoke_graph with graph_id 'onboarding-assembly' and input set to the customer name, then report the returned output."]}
```

Start an agent session on `onboarding-coordinator` with an instruction like
`Onboard the new customer Acme Corp`. The agent calls `invoke_graph`, the
`onboarding-assembly` graph runs nested inside the session, and the rolled-up
output comes back as the tool result.

## Testing

Start a coordinator session and poll `GET /v1/sessions/<id>` until it ends.

Expected outcome (verified):

- The coordinator's `workspace_ext__invoke_graph` tool result carries the
  fully-assembled onboarding summary, which only renders if **every** child
  subgraph's output propagated:

  ```
  KYC=KYC VERIFIED for Acme Corp | PROV=ACCOUNT PROVISIONED.
  region #0: REGION READY
  region #1: REGION READY
  region #2: REGION READY
  ```

- The parent graph state (`.state/graphs/<sid>/state.json`, where `<sid>` is the
  nested invoke-graph run id) records the sequential children `kyc` and
  `provision` as `ended`, plus one `region[i]` node per broadcast instance, each
  with its own isolated node directory under `.state/graphs/<sid>/nodes/`. The
  invoke-graph run nests under the agent session, and each region instance is its
  own run dir (`...__region[0]`, `...__region[1]`, `...__region[2]`), never one
  shared `...__region`.
- A failing child fails the parent: if you point a parent's subgraph node at a
  child graph that ends `failed`, the parent graph ends `failed` and that
  subgraph node is marked `failed` with the child's failure detail. Composition
  surfaces the failure instead of marching on.

### Notes and limitations

- **Both subgraph paths are covered.** Composition has two code paths that behave
  identically here: the `kind: graph` NODE path (used by the sequential and
  broadcast children inside the parent) and the `workspace_ext::invoke_graph`
  TOOL path (used by the coordinator to run the parent). Both capture the child's
  End output and both fail the caller when the child fails.
- **Keep nesting shallow.** Two levels of nesting (coordinator -> parent ->
  child) is exercised and clean. Deeply nested broadcast-over-subgraph trees
  multiply the number of concurrent child runs, so size your `count` and
  `max_iterations` for the fan-out you actually need.
- **The child graph's `end` output is the contract.** Whatever a child graph's
  `end` node renders is what the parent reads on `nodes.<child>.text`. Give each
  child a deliberate `end` `output_template` (or `output_schema` for a parsed
  object) rather than relying on whatever the last node happened to stream.
