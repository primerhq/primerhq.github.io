---
slug: cookbook-fanout-code-review
title: Fan-out code review
section: cookbook
summary: "A graph that reviews a piece of code from several angles in parallel, then aggregates every reviewer's findings into one report."
difficulty: advanced
time_minutes: 20
tags: ["graphs", "fan-out", "code-review", "parallel"]
---

## Goal

Review a change the way a good team does - several specialists, each looking for a
different class of problem - and collect their findings into one report. A graph
**fans out** the same code to independent reviewer agents (bugs, style, security, ...)
and **fans in** their outputs to a single aggregated review.

This recipe shows the graph **fan-out (`tee`)** and **fan-in** node types.

## Ingredients

- **An LLM provider.**
- One reviewer agent per angle you care about. This recipe uses two: a bug reviewer
  and a style reviewer.

## Walkthrough

### 1. Create the reviewer agents

`system::create_agent` (repeat per angle)
```json
{"id": "reviewer-bugs", "description": "Code reviewer.", "model": {"provider_id": "<llm>", "model_name": "<model>"}, "tools": [], "system_prompt": ["You review code for BUGS and correctness issues ONLY. List concrete bugs concisely; if none, say so."]}
```
```json
{"id": "reviewer-style", "description": "Code reviewer.", "model": {"provider_id": "<llm>", "model_name": "<model>"}, "tools": [], "system_prompt": ["You review code for STYLE and readability issues ONLY. List concrete style improvements concisely; if none, say so."]}
```

### 2. Create the fan-out / fan-in graph

A `fan_out` node with a `tee` spec dispatches the same input to each reviewer; a
`fan_in` node waits for all of them and renders an aggregate.

`system::create_graph`
```json
{
  "id": "code-review",
  "description": "Fan-out code review: parallel reviewers, aggregated.",
  "max_iterations": 10,
  "nodes": [
    {"kind": "begin", "id": "start", "input_schema": {"type": "object", "required": ["code"], "properties": {"code": {"type": "string"}}}},
    {"kind": "fan_out", "id": "split", "specs": [{"kind": "tee", "target_node_ids": ["review_bugs", "review_style"]}]},
    {"kind": "agent", "id": "review_bugs", "agent_id": "reviewer-bugs", "input_template": "Review this code for BUGS only:\n{{ initial_input.code }}"},
    {"kind": "agent", "id": "review_style", "agent_id": "reviewer-style", "input_template": "Review this code for STYLE only:\n{{ initial_input.code }}"},
    {"kind": "fan_in", "id": "combine", "aggregate_template": "## Bugs\n{{ nodes.review_bugs[0].text }}\n\n## Style\n{{ nodes.review_style[0].text }}"},
    {"kind": "end", "id": "done", "output_template": "{{ nodes.combine.text }}"}
  ],
  "edges": [
    {"kind": "static", "from_node": "start", "to_node": "split"},
    {"kind": "static", "from_node": "review_bugs", "to_node": "combine"},
    {"kind": "static", "from_node": "review_style", "to_node": "combine"},
    {"kind": "static", "from_node": "combine", "to_node": "done"}
  ]
}
```

Three things that will save you a failed run:

- **Fan-out targets are addressed as a list.** A `tee` puts each target's output at
  `nodes.<target>` as a **one-element list**, so the fan-in template reads
  `{{ nodes.review_bugs[0].text }}`, *not* `{{ nodes.review_bugs.text }}` (the latter
  ends the graph with `ended_detail: template_error`, "'list object' has no attribute
  'text'").
- **The fan_out spec does the dispatch; you wire the join.** You do *not* add
  `split -> reviewer` edges (the `target_node_ids` spawn them). You *do* add
  `reviewer -> combine` edges - the fan_in fires only when every incoming edge's
  source has produced output.
- **Adding an angle is one agent + two lines:** a new reviewer agent, its node listed
  in `target_node_ids`, and a `reviewer -> combine` edge. On a single-concurrency LLM
  the reviewers serialize, but each still gets an independent pass.

### 3. Wire it to your workflow

Drive the graph however the change arrives: a `scheduled` trigger for a nightly sweep,
or a `webhook` trigger from your forge on each PR (pass the diff as `graph_input.code`).
Deliver the aggregated report by having a final agent post it (see the
[stock-news monitor](cookbook-scheduled-stock-monitor) for the `inform_user` pattern).

## Testing

Run the graph with a small, deliberately flawed function as `graph_input`:

```json
{"code": "def divide(a, b):\n    result = a / b\n    return result"}
```

Expected outcome (verified):

- The `tee` dispatches both reviewers; in the graph state you see `review_bugs` and
  `review_style` **running at the same superstep**.
- The bug reviewer flags the real defect - *"does not handle the case where `b` is
  zero, which would cause a `ZeroDivisionError`"* - while the style reviewer
  independently suggests *"return the result directly without assigning it ... add a
  docstring"*.
- The graph ends `completed`, and the end output is the aggregated **## Bugs / ##
  Style** report from the fan_in.
