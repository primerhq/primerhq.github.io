---
slug: cookbook-fanout-code-review
title: Fan-out code review
section: cookbook
summary: "A graph that reviews a piece of code from several angles in parallel, then aggregates every reviewer's findings into one report. Built in the graph editor or with a primectl manifest."
difficulty: advanced
time_minutes: 20
tags: ["graphs", "fan-out", "code-review", "parallel"]
---

## Goal

Review a change the way a good team does, with several specialists each looking
for a different class of problem, and collect their findings into one report. A
graph **fans out** the same code to independent reviewer agents (bugs, style,
security, ...) and **fans in** their outputs to a single aggregated review.

This recipe shows the graph **fan-out (`tee`)** and **fan-in** node types. As with
the other recipes, each step is shown **in the console** first, then **Via the
CLI**. For a graph, the visual editor and the CLI manifest describe the exact same
spec; the manifest is often the clearest way to read a tee/fan-in graph, so this
recipe leads the graph step with the editor's **Import spec** paste (which takes
that same JSON) and the `primectl create graph -f` manifest.

## Ingredients

- **An LLM provider.**
- One reviewer agent per angle you care about. This recipe uses two: a bug reviewer
  and a style reviewer.

If you have not connected `primectl` yet, see "Connecting the CLI" in the
[RAG knowledge base](cookbook-rag-knowledge-base) recipe.

## Walkthrough

### 1. Create the reviewer agents

One agent per review angle; each is scoped by its system prompt to one concern.

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On **Basic** set **ID** to `reviewer-bugs` and pick the **LLM provider** +
   **Model**; leave **Tools** empty; on **Advanced** paste the bug-review system
   prompt. Click **Create**.
3. Repeat for `reviewer-style` with the style-review system prompt.

Via the CLI:

```
primectl create -f reviewer-bugs.yaml
primectl create -f reviewer-style.yaml
```

```yaml
kind: agent
spec:
  id: reviewer-bugs
  description: Code reviewer.
  model: { provider_id: <llm>, model_name: <model> }
  tools: []
  system_prompt:
    - >-
      You review code for BUGS and correctness issues ONLY. List concrete bugs
      concisely; if none, say so.
```

```yaml
kind: agent
spec:
  id: reviewer-style
  description: Code reviewer.
  model: { provider_id: <llm>, model_name: <model> }
  tools: []
  system_prompt:
    - >-
      You review code for STYLE and readability issues ONLY. List concrete style
      improvements concisely; if none, say so.
```

### 2. Create the fan-out / fan-in graph

A `fan_out` node with a `tee` spec dispatches the same input to each reviewer; a
`fan_in` node waits for all of them and renders an aggregate.

In the console:

1. Go to **Compute > Graphs** and click **New graph**. Give it the **ID**
   `code-review` and pick any **Seed agent** (the seed Begin/agent/End is just a
   starting skeleton you will replace). Click **Create** to open the visual editor.
2. The fastest way to build the exact graph below is the editor's raw paste: click
   **Import spec**, paste the JSON from the manifest's `spec` (the `nodes`,
   `edges`, and `entry_node_id`), and click **Load into editor**. Then click
   **Save**.
3. Or build it node by node with **Add node**: a **Begin**, a **Fan-out** (set its
   mode to **tee** and list `review_bugs` and `review_style` as targets), the two
   **Agent** nodes (pick `reviewer-bugs` / `reviewer-style` and set each
   `input_template`), a **Fan-in** (set the `aggregate_template`), and an **End**
   (set the `output_template`). Use **Add edge** in **Static** mode to wire
   `start -> split`, `review_bugs -> combine`, `review_style -> combine`, and
   `combine -> done`. Click **Save**.

Via the CLI:

```
primectl create -f review-graph.yaml
```

```yaml
kind: graph
spec:
  id: code-review
  description: "Fan-out code review: parallel reviewers, aggregated."
  max_iterations: 10
  nodes:
    - { kind: begin, id: start, input_schema: { type: object, required: [code], properties: { code: { type: string } } } }
    - { kind: fan_out, id: split, specs: [ { kind: tee, target_node_ids: [review_bugs, review_style] } ] }
    - { kind: agent, id: review_bugs, agent_id: reviewer-bugs, input_template: "Review this code for BUGS only:\n{{ initial_input.code }}" }
    - { kind: agent, id: review_style, agent_id: reviewer-style, input_template: "Review this code for STYLE only:\n{{ initial_input.code }}" }
    - { kind: fan_in, id: combine, aggregate_template: "## Bugs\n{{ nodes.review_bugs[0].text }}\n\n## Style\n{{ nodes.review_style[0].text }}" }
    - { kind: end, id: done, output_template: "{{ nodes.combine.text }}" }
  edges:
    - { kind: static, from_node: start, to_node: split }
    - { kind: static, from_node: review_bugs, to_node: combine }
    - { kind: static, from_node: review_style, to_node: combine }
    - { kind: static, from_node: combine, to_node: done }
```

Three things that will save you a failed run:

- **Fan-out targets are addressed as a list.** A `tee` puts each target's output
  at `nodes.<target>` as a **one-element list**, so the fan-in template reads
  `{{ nodes.review_bugs[0].text }}`, *not* `{{ nodes.review_bugs.text }}` (the
  latter ends the graph with `ended_detail: template_error`, "'list object' has no
  attribute 'text'").
- **The fan_out spec does the dispatch; you wire the join.** You do *not* add
  `split -> reviewer` edges (the `target_node_ids` spawn them). You *do* add
  `reviewer -> combine` edges; the fan_in fires only when every incoming edge's
  source has produced output.
- **Adding an angle is one agent + two lines:** a new reviewer agent, its node
  listed in `target_node_ids`, and a `reviewer -> combine` edge. On a
  single-concurrency LLM the reviewers serialize, but each still gets an
  independent pass.

### 3. Run it

The graph's Begin node declares an `input_schema` with a `code` field, so both the
console and the CLI can pass the code in as structured graph input.

In the console:

1. Click **New session**, set the **Binding** to `graph`, and pick the
   `code-review` graph and a **Workspace**.
2. Because the graph declares an input schema, the modal renders a **code** field;
   paste the code to review there. Click **Create** and watch the run.

Via the CLI:

```
primectl session run <workspace-id> --graph code-review --graph-input '{"code": "def divide(a, b):\n    return a / b"}'
```

To wire it into your workflow instead, drive the graph however the change arrives:
a `scheduled` trigger for a nightly sweep, or a `webhook` trigger from your forge
on each PR (pass the diff as `graph_input.code`). Deliver the aggregated report by
having a final agent post it (see the
[stock-news monitor](cookbook-scheduled-stock-monitor) for the `inform_user`
pattern).

## Testing

Run the graph with a small, deliberately flawed function as the code input:

```json
{"code": "def divide(a, b):\n    result = a / b\n    return result"}
```

Expected outcome (verified):

- The `tee` dispatches both reviewers; in the graph state you see `review_bugs` and
  `review_style` running **at the same superstep** (the same `last_run_iteration`).
- The bug reviewer flags the real defect, for example *"does not handle the case
  where `b` is zero, which would cause a `ZeroDivisionError`"*, while the style
  reviewer independently suggests *"return the result directly without assigning it
  ... add a docstring"*.
- The graph ends `completed`, and the end output is the aggregated **## Bugs / ##
  Style** report from the fan_in.
