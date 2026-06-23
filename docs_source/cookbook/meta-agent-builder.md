---
slug: cookbook-meta-agent-builder
title: Meta-agent that builds agents
section: cookbook
summary: "An agent that takes a plain-language use case, discovers the tools already on the platform, and creates a new agent to solve it, set up from the console or with the primectl CLI."
difficulty: advanced
time_minutes: 20
tags: ["agents", "semantic-search", "meta", "dynamic"]
---

## Goal

Describe a job in one sentence and have the platform build the agent for it. A
**meta-agent** searches the platform's own catalogue for reusable tools (and agents,
collections, graphs), then calls `create_agent` to register a working agent wired to
the tools it found - no hand-assembly.

This recipe shows the platform's **internal semantic search** (over its own tools and
entities) and **dynamic agent creation** from inside an agent. The operator's job is
to activate the internal search subsystem, create the meta-agent once, and start a
session; the meta-agent does the discovery and the creation at runtime. Each setup step
is shown two ways: first **in the console**, then **via the CLI**.

## Ingredients

- **An LLM provider.**
- An **embedding provider** and a **semantic search provider** (the internal catalogue
  is embedded for `search_tools` to be real).
- The **`search`** toolset (`search_tools`, and optionally `search_agents`,
  `search_collections`, `search_graphs` - semantic search over the platform's own
  `_internal_*` catalogue).
- **`system__create_agent`** so the meta-agent can register what it designs.
- A **local workspace** for the meta-agent session.
- To drive the CLI path, point `primectl` at your instance once; see the one-time
  [Connecting the CLI](cookbook-rag-knowledge-base) block in the RAG recipe.

## Walkthrough

### 1. Activate the internal search subsystem

`search_tools` searches an embedded catalogue of the platform's own tools, so the
subsystem needs an embedder and a search provider, then a one-time bootstrap that
indexes the catalogue. Create the providers the same way the RAG recipe does
(**Providers > Embedding** and **Providers > Semantic Search**, or
`primectl create -f embedder.yaml` / `ssp.yaml`), then point the subsystem at them.

In the console:

1. Go to **Subsystems > Internal Collections**, set the **Embedding provider**,
   **Embedding model**, and **Search provider** in the config form, and save.
2. Click **Bootstrap** and watch the status pill: it runs in the background and turns
   to `succeeded` when the catalogue is indexed.

Via the CLI (the internal-collections subsystem is a singleton, so it is configured and
bootstrapped with `primectl raw`, the explicit escape hatch):

```
primectl raw PUT /v1/internal_collections/config -f ic_config.yaml
primectl raw POST /v1/internal_collections/bootstrap
primectl raw GET /v1/internal_collections/bootstrap/status   # poll until "succeeded"
```

where `ic_config.yaml` is:

```yaml
embedding_provider_id: <embedder>
embedding_model: <embed-model>
search_provider_id: <ssp>
```

### 2. Create the meta-agent

It binds `search_tools` plus `create_agent`. The system prompt makes it discover first,
then create once.

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On the **Basic** tab set **ID** to `meta-builder`, add a **Description**, and pick
   the **LLM provider** and **Model**.
3. On the **Tools** tab check `search__search_tools` and `system__create_agent`.
4. On the **Advanced** tab paste the system prompt (below). Click **Create**.

Via the CLI:

```
primectl create -f meta-builder.yaml
```

where `meta-builder.yaml` is:

```yaml
kind: agent
spec:
  id: meta-builder
  description: Builds new agents from a use case by discovering existing tools.
  model:
    provider_id: <llm>
    model_name: <model>
  tools:
    - search__search_tools
    - system__create_agent
  max_tool_turns: 8
  system_prompt:
    - >-
      You build new agents. Given a use case: (1) call search_tools to find relevant
      platform tools (it returns scoped ids like misc__get_datetime); (2) call
      create_agent ONCE to create a new agent that solves the use case. The
      create_agent arguments must include: id (a short slug), description, model
      {provider_id, model_name}, tools (the scoped tool ids you found), and
      system_prompt (a list with one instruction string). Report the new agent id.
```

### 3. Run the meta-agent with a use case

Start a session bound to the meta-agent and pass the use case as the instruction.

In the console:

1. Click **New session**, set the **Binding** to `agent`, pick `meta-builder`, choose a
   **Workspace**, and type the use case into **Initial instructions**.
2. Click **Create** and watch the transcript: the agent calls `search_tools`, then
   `create_agent`. The new agent it builds appears on the Agents page.

Via the CLI:

```
primectl session run <workspace-id> --agent meta-builder \
  -i "Use case: build an agent that returns the current date and time on request."
```

A few things worth knowing:

- **`search_tools` returns scoped ids** (`<toolset>__<tool>`) - exactly the shape an
  agent's `tools` list needs, so the meta-agent can paste them straight into
  `create_agent`. Internal search is also how it finds existing **agents**
  (`search_agents`), **collections**, and **graphs** to reuse instead of rebuilding.
- **`create_agent` ids are immutable.** If the meta-agent picks an id that exists, the
  call fails - have it choose a fresh slug.
- **Yielding tools can't come over MCP.** When the meta-agent discovers an external
  **MCP server**, register it as a toolset (the `mcp` toolset-provider kind) before
  `create_agent`, since the new agent's `tools` must reference already-registered ids;
  only the MCP server's request/response tools are usable.
- **Want parallel discovery?** Wrap the four searches (`search_tools` / `search_agents`
  / `search_collections` / `search_graphs`) as a `fan_out` (`tee`) in a graph that fans
  into a planner, then a builder node. On a single-concurrency LLM the searches
  serialize either way, so a single agent (above) is the simpler equivalent.

## Testing

> "Use case: build an agent that returns the current date and time on request."

Expected outcome (verified):

- The meta-agent calls `search_tools`, finds the datetime tool (`misc__get_datetime`),
  and calls `create_agent`. Watch the transcript on the Sessions page, or read
  `ended: completed` from `session run`.
- A **new agent appears** on the Agents page - for example `datetime-agent` with
  `tools: ["misc__get_datetime"]` - that you can immediately run. Confirm with
  `primectl get agent datetime-agent -o yaml`.
- The freshly built agent is immediately runnable: start a session bound to it
  (**New session** or `primectl session run <workspace-id> --agent datetime-agent
  -i "what time is it"`) and watch it reach a clean terminal.

Try other one-line use cases ("an agent that searches the web and summarizes", "an
agent that answers from the kb collection") and watch it wire up the matching tools
each time.
