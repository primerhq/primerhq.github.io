---
slug: cookbook-meta-agent-builder
title: Meta-agent that builds agents
section: cookbook
summary: "An agent that takes a plain-language use case, discovers the tools and agents already on the platform, and creates a new agent to solve it."
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
entities) and **dynamic agent creation** from inside an agent.

## Ingredients

- **An LLM provider.**
- The **`search`** toolset (`search_tools`, and optionally `search_agents`,
  `search_collections`, `search_graphs` - semantic search over the platform's own
  `_internal_*` catalogue).
- **`system__create_agent`** so the meta-agent can register what it designs.
- Optionally the **`web`** toolset to discover external MCP servers for capabilities
  the platform does not have yet.

## Walkthrough

### Create the meta-agent

`system::create_agent`
```json
{
  "id": "meta-builder",
  "description": "Builds new agents from a use case by discovering existing tools.",
  "model": {"provider_id": "<llm>", "model_name": "<model>"},
  "tools": ["search__search_tools", "system__create_agent"],
  "max_tool_turns": 8,
  "system_prompt": ["You build new agents. Given a use case: (1) call search_tools to find relevant platform tools (it returns scoped ids like misc__get_datetime); (2) call create_agent ONCE to create a new agent that solves the use case. The create_agent arguments must include: id (a short slug), description, model {provider_id, model_name}, tools (a list of the scoped tool ids you found), and system_prompt (a list with one instruction string). Report the new agent id you created."]
}
```

Run it with a use case as the instruction (a workspace session, or fire it from a
trigger):

```
Use case: build an agent that returns the current date and time on request.
```

A few things worth knowing:

- **`search_tools` returns scoped ids** (`<toolset>__<tool>`) - exactly the shape an
  agent's `tools` list needs, so the meta-agent can paste them straight into
  `create_agent`. Internal search is also how it can find existing **agents**
  (`search_agents`), **collections**, and **graphs** to reuse instead of rebuilding.
- **`create_agent` ids are immutable.** If the meta-agent picks an id that exists, the
  call fails - have it choose a fresh slug.
- **Yielding tools can't come over MCP.** When the meta-agent discovers an external
  **MCP server** on the web, register it as a toolset (the `mcp` toolset-provider
  kind) *before* `create_agent`, since the new agent's `tools` must reference already-
  registered ids; only the MCP server's request/response tools are usable.
- **Want parallel discovery?** Wrap the four searches (`search_tools` / `search_agents`
  / `search_collections` / `search_graphs`) as a `fan_out` (`tee`) in a graph that
  fans into a planner, then a builder node. On a single-concurrency LLM the searches
  serialize either way, so a single agent (above) is the simpler equivalent.

## Testing

> "Use case: build an agent that returns the current date and time on request."

Expected outcome (verified):

- The meta-agent calls `search_tools`, finds the datetime tool (`misc__get_datetime`),
  and calls `create_agent`.
- A **new agent appears** in `GET /v1/agents` - e.g. `datetime_agent` with
  `tools: ["misc__get_datetime"]` - that you can immediately run.
- Try other one-line use cases ("an agent that searches the web and summarizes",
  "an agent that answers from the kb collection") and watch it wire up the matching
  tools each time.
