---
slug: toolsets-overview
title: Toolsets & Tools
section: toolsets
summary: How tools are grouped into toolsets, the three kinds (built-in, external MCP, and python modules you write), and how approvals gate tool calls.
---

## Tools and toolsets

A **tool** is one callable function an agent can invoke during a turn: it has an id, a JSON argument schema, and a handler. A **toolset** is a named collection of related tools. An agent is bound to toolsets (not individual tools at the wire level), and its effective tool list is the union of every toolset it has.

Tool ids are scoped by their toolset using a double-underscore separator, for example `system__invoke_agent`, `search__search_agents`, or `web__web_search`.

## Three kinds of toolset

- **System (built-in) toolsets** ship with primer and are always available: agents, search, workspaces, web, and the rest. They are reserved; you cannot create or delete them, only bind agents to them and pick which tools are exposed.
- **External toolsets** are registered by you and pull tools in from outside primer over a transport. Today the one external kind is MCP (Model Context Protocol) servers.
- **Python toolsets** are written by you, as a python module stored in the toolset itself. Every function decorated with `@primer_tool` becomes a tool, and primer runs it in a sandboxed subprocess. Nothing to host, nothing to deploy.

What separates them is where the tool's code lives: shipped with primer, behind a transport you point at, or in the toolset record. All three appear in the same toolset list and bind to agents the same way.

## Explore the Tools catalogue

Open **Platform > Tools**, or use **Open Tools** in the command palette.
Each card shows its scoped id and toolset, plus the facts available for
that tool: its origin (`generated`, shipped `curated`, or `user`), its
REST method and path when mapped, and its `reference/tools/...` wiki
reference path. The reference is shown as text. Filter by toolset, name,
origin, or REST method/path. **Open** takes you to the owning toolset.
On a phone, open Tools from Platform and tap a tool for the same facts.

The page loads once and reloads when you choose **Refresh**. Below the
tools, **Reviewed skips** lists REST operations deliberately kept outside
tools, such as browser sign-in. Administrators also see coverage totals
and MCP exposure configuration. Non-admins retain the existing tool
picker list, but do not receive admin-operation mappings, admin skips,
exposure configuration, or coverage totals.

An approval fact labelled **default policy** describes the policy shipped
with the tool. An operator may change it; the live approval decision can
differ. MCP exposure facts likewise describe configuration, not a promise
that a particular caller can run the tool. Use **System > MCP** to change
exposure settings. Role, toolset access, the endpoint switch, and live
approval checks still apply when a tool is called.

## Approvals

Any tool call can be gated behind an approval policy, so a human (or another agent) must sign off before the call runs. Approvals are configured per agent and per tool, independent of which toolset the tool came from.

```ref:toolsets/toolsets-system
The built-in system toolsets and how to explore tools with list_toolset_tools and call_tool.
```

```ref:toolsets/toolsets-external
Register external toolsets (MCP servers) over stdio and HTTP so agents can call their tools.
```

```ref:toolsets/toolsets-python
Write a python function and get a callable tool, including tools that park a run until a human answers.
```

```ref:toolsets/toolsets-approvals
Gate tool calls behind an approval policy and decide each request before it runs.
```
