---
slug: cookbook-iterative-web-research
title: Iterative web-research loop
section: cookbook
summary: "A graph of three agents that researches a topic on the web, distils sourced facts, and uses a judge to loop back for another pass until the brief is good enough. Built in the console or with primectl."
difficulty: intermediate
time_minutes: 20
tags: ["graphs", "web", "loop", "structured-output", "judge"]
---

## Goal

Give the system a topic and get back a list of verified, sourced facts. A
**researcher** agent searches the web and writes findings, an **extractor**
distils them into atomic facts with source URLs, and a **judge** decides whether
the result is good enough or needs another pass. The judge routes the graph back
to the researcher (with the gaps it found) until it is satisfied, then ends.

This recipe is the canonical "research loop": a graph with a conditional
back-edge, structured output driving the routing, and node outputs carrying
state between steps. As with the other recipes, each step is shown **in the
console** first, then **Via the CLI**. For a graph the visual editor and the CLI
manifest describe the exact same spec, so this recipe leads the graph step with
the editor's **Import spec** paste (which takes that same JSON) and the
`primectl create graph -f` manifest.

## Ingredients

- **An LLM provider** (any chat model). This recipe was verified on a local
  LM Studio model; substitute your own provider and model.
- **A web-search provider** (DuckDuckGo, Tavily, ...) so the `web` toolset's
  `web_search` / `web_fetch` tools work.
- **A workspace** with the default `local` backend (the graph runs as a session
  inside it; node outputs and per-node history live under its `.state/`).
- Three agents and one graph (created below). No channels, no triggers.

If you have not connected `primectl` yet, see "Connecting the CLI" in the
[RAG knowledge base](cookbook-rag-knowledge-base) recipe.

## Walkthrough

### 1. Create the three agents

The researcher binds the web toolset; the extractor and judge need no tools (the
graph passes node outputs to them through their `input_template`).

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On **Basic** set **ID** to `web-researcher` and pick the **LLM provider** +
   **Model**; on the **Tools** tab filter for `web_search` / `web_fetch` and
   check `web__web_search` and `web__web_fetch`; on **Advanced** paste the
   researcher system prompt. Click **Create**.
3. Repeat for `fact-extractor` and `research-judge` with no tools and their own
   system prompts (below).

Via the CLI:

```
primectl create -f researcher.yaml
primectl create -f extractor.yaml
primectl create -f judge.yaml
```

```yaml
kind: agent
spec:
  id: web-researcher
  description: Searches the web and writes a short sourced findings report.
  model: { provider_id: <llm>, model_name: <model> }
  tools:
    - web__web_search
    - web__web_fetch
  system_prompt:
    - >-
      You are a web researcher. Given a topic (and optionally gaps to fill), use
      web_search to find sources and web_fetch to read the most relevant one or
      two. Write a short findings report (bullet points with the source URL for
      each claim). Be concise; do not fabricate.
```

```yaml
kind: agent
spec:
  id: fact-extractor
  description: Distils sourced facts from research findings.
  model: { provider_id: <llm>, model_name: <model> }
  tools: []
  system_prompt:
    - >-
      You distil research findings into verified facts. From the findings in
      your input, output a clean numbered list of atomic facts, each with its
      source URL. Keep only claims supported by a source. Do not add commentary.
```

```yaml
kind: agent
spec:
  id: research-judge
  description: Judges whether the research is complete; returns a structured verdict.
  model: { provider_id: <llm>, model_name: <model> }
  tools: []
  system_prompt:
    - >-
      You are a fact-checking judge. Given the topic and the current facts,
      return JSON only: verdict is accept or revise; gaps is a short list of what
      is still missing (empty if accept); confidence is 0 to 1. Prefer accept
      once the core of the topic is reasonably covered; choose revise only if an
      essential aspect is entirely missing.
```

### 2. Create the graph

`begin -> researcher -> extractor -> judge`, then a **conditional** edge: the
judge's `verdict` routes to `done` (accept) or back to the researcher (revise).
The judge node carries a `response_format` so its output is structured JSON the
router can read at `nodes.judge.parsed.verdict`.

In the console:

1. Go to **Compute > Graphs** and click **New graph**. Give it the **ID**
   `research-loop` and pick any **Seed agent** (the seed Begin/agent/End is just
   a starting skeleton you will replace). Click **Create** to open the visual
   editor.
2. The fastest way to build the exact graph below is the editor's raw paste:
   click **Import spec**, paste the JSON from the manifest's `spec` (the
   `nodes`, `edges`, and `max_iterations`), and click **Load into editor**. Then
   click **Save**.
3. Or build it node by node with **Add node**: a **Begin** (set its
   `input_schema` with a `topic` field), three **Agent** nodes (pick
   `web-researcher` / `fact-extractor` / `research-judge` and set each
   `input_template`; on the judge set its `response_format`), and an **End** (set
   the `output_template`). Use **Add edge** in **Static** mode to wire
   `start -> researcher`, `researcher -> extractor`, and `extractor -> judge`,
   then add one **Conditional** edge from `judge` with a `json_path` router whose
   branches send `accept -> done` and `revise -> researcher`. Click **Save**.

Via the CLI:

```
primectl create -f research-graph.yaml
```

```yaml
kind: graph
spec:
  id: research-loop
  description: Research a topic, distil sourced facts, and judge until accepted.
  max_iterations: 12
  nodes:
    - { kind: begin, id: start, input_schema: { type: object, required: [topic], properties: { topic: { type: string } } } }
    - kind: agent
      id: researcher
      agent_id: web-researcher
      input_template: "{% if 'judge' in nodes %}Do another web_search/web_fetch pass to fill these gaps, then write an updated sourced findings report.\nGaps: {{ nodes.judge.parsed.gaps | join('; ') }}\nTopic: {{ initial_input.topic }}{% else %}Research this topic using web_search and web_fetch, then write a short sourced findings report: {{ initial_input.topic }}{% endif %}"
    - kind: agent
      id: extractor
      agent_id: fact-extractor
      input_template: "Extract the verified, sourced facts from these findings and output them as a clean numbered list (each fact with its source URL):\n\n{{ nodes.researcher.text }}"
    - kind: agent
      id: judge
      agent_id: research-judge
      input_template: "Topic: {{ initial_input.topic }}\n\nCurrent facts:\n{{ nodes.extractor.text }}\n\nDecide if this is sufficient and correct. Return JSON only."
      response_format: { type: object, required: [verdict, gaps, confidence], properties: { verdict: { type: string, enum: [accept, revise] }, gaps: { type: array, items: { type: string } }, confidence: { type: number } } }
    - { kind: end, id: done, output_template: "{{ nodes.extractor.text }}" }
  edges:
    - { kind: static, from_node: start, to_node: researcher }
    - { kind: static, from_node: researcher, to_node: extractor }
    - { kind: static, from_node: extractor, to_node: judge }
    - kind: conditional
      from_node: judge
      router:
        kind: json_path
        branches:
          - { conditions: [{ path: verdict, op: eq, value: accept }], to_node: done }
          - { conditions: [{ path: verdict, op: eq, value: revise }], to_node: researcher }
        default_to: done
```

Three things that will save you an afternoon:

- **Detect loop passes with `{% if '<node>' in nodes %}`, not `iteration == 0`.**
  `iteration` is a global superstep counter, so it is not `0` on the
  researcher's first run. The first run takes the `else` branch because `judge`
  is not yet a key in `nodes`; later passes take the `if` branch and read the
  judge's gaps.
- **`max_iterations` counts supersteps (node executions), not loops.** A
  five-node graph with one revision needs roughly
  `start + (researcher, extractor, judge) x passes + done` steps, so leave
  generous headroom (12 here). Too low and the run ends `failed` with
  `max_iterations_exceeded` mid-pipeline.
- **A node's `response_format` is what makes routing work.** The judge's JSON is
  parsed into `nodes.judge.parsed`, which the `json_path` router reads.

### 3. Run it

The graph's Begin node declares an `input_schema` with a `topic` field, so both
the console and the CLI pass the topic in as structured graph input.

In the console:

1. Click **New session**, set the **Binding** to `graph`, and pick the
   `research-loop` graph and a **Workspace**.
2. Because the graph declares an input schema, the modal renders a **topic**
   field; type your topic there. Click **Create** and watch the run.

Via the CLI:

```
primectl session run <workspace-id> --graph research-loop \
  --graph-input '{"topic": "the current latest stable version of Python and one or two of its new features"}'
```

`session run` creates the session, then polls it to completion and prints the
progress. (If you do not have a workspace yet, create a local one with a
`workspace_provider`, a matching `workspace_template`, then
`primectl create workspace --set template_id=<tpl>`.)

### 4. Watch it run

The run takes a few minutes (each agent node is a full LLM turn, plus web
latency). To follow node-by-node progress and catch any per-node error, read the
graph's on-disk state.

In the console, open the running session and switch to its **Graph** view: each
node shows its `status` and any `error`, and the run shows its final `status` /
`ended_reason`.

Via the CLI, read the state file through the workspace file API (no host-path
knowledge needed):

```
primectl workspace files get <workspace-id> .state/graphs/<session-id>/state.json --content
```

It carries each node's `status` and `error`, and the graph's final `status` /
`ended_reason`. The final facts and each node's history live under
`.state/graphs/<session-id>/nodes/<node-id>/` (list them with
`primectl workspace files ls <workspace-id> .state/graphs/<session-id>/nodes -R`).

## Testing

Run it on a topic with a concrete, checkable answer:

> topic: "the current latest stable version of Python and one or two of its new features"

Expected outcome (verified):

- The graph ends `completed` with all nodes `ended`:
  `start -> researcher -> extractor -> judge -> done`.
- The researcher actually calls the web (you will see real source URLs in its
  findings); the extractor emits a numbered, sourced fact list, e.g.
  *"1. The latest stable version of Python is 3.13.x (source:
  https://www.python.org/downloads/source/) ... Python 3.13 includes an improved
  interactive interpreter based on code from PyPy ..."*
- The judge emits structured JSON (`{"verdict": "accept", "gaps": [],
  "confidence": 1.0}`), and the router sends the graph to `done`.

To exercise the **loop**, give it a deliberately broad topic (so the judge finds
gaps and returns `revise`) and watch the state route back to `researcher` for a
second pass before accepting. You can confirm the back-edge fired: the
researcher node's `last_run_iteration` advances past its first run. To see the
failure mode, set `max_iterations` to `3` and watch it end
`failed / max_iterations_exceeded` at the judge step.
