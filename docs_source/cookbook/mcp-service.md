---
slug: cookbook-mcp-service
title: Primer-as-a-Service over MCP
section: cookbook
summary: "Let an external MCP client (an IDE assistant, Claude Desktop, or any MCP-speaking agent) offload a long task to primer: spin up a workspace session, let it run, read the result, and cancel it - all over MCP, never touching primer's REST API."
difficulty: intermediate
time_minutes: 20
tags: ["mcp", "workspaces", "sessions", "external-agent", "integration"]
---

## Goal

You have an external agent - an IDE assistant, Claude Desktop, claude.ai, or any
MCP-speaking system - and you want it to use **primer as a remote execution
backend**. Instead of running a long task in its own context, the external agent
hands it to primer: it spins up a workspace **session**, lets the session run,
polls for the result, reads it back, and can cancel a run it no longer needs.
The external agent drives all of this over primer's built-in MCP endpoint and
never touches primer's REST API or console.

This recipe shows the **MCP server surface**: the `McpExposure` allowlist that
controls which tools are published, and the workspace **session** tools an
external client uses to create, inspect, read, and cancel a run. For the full
description of the endpoint, see the [MCP Server feature](mcp-server).

## Ingredients

- **The built-in MCP endpoint** at `/v1/mcp`. It is off by default; you opt in
  with an `McpExposure` record.
- **An `McpExposure` allowlist** naming the session-drive tools. The minimal set
  is:
  - `workspaces__create_workspace_session` - start an agent (or graph) session.
  - `workspaces__get_workspace_session` - poll its lifecycle state.
  - `workspaces__read_workspace_file` - read its output.
  - `workspaces__cancel_workspace_session` - stop a run.
- **An agent and a workspace** for the external client to run. Any existing
  agent on a `local` (or container / kubernetes) workspace works.
- **An MCP client** that speaks the StreamableHTTP transport, authenticated to
  the endpoint (a bearer token with the `mcp` scope, or a console cookie
  session).

> All four allowlisted tools are non-yielding and do not require an active agent
> session, so they pass the MCP exposability floor. Tools that **park** (such as
> `system__ask_user`) or that need a live `session_id` are rejected from the
> allowlist by design - see the [exposure model](mcp-server) for why.

## Walkthrough

### 1. Enable MCP exposure with the session-drive allowlist

Turn the endpoint on and publish exactly the four session tools. Saving a new
allowlist replaces the previous one atomically, and only the listed tools appear
on the client's `tools/list`.

`PUT /v1/mcp_exposure`
```json
{
  "enabled": true,
  "allowed_tools": [
    "workspaces__create_workspace_session",
    "workspaces__get_workspace_session",
    "workspaces__read_workspace_file",
    "workspaces__cancel_workspace_session"
  ]
}
```

The PUT re-runs the exposability floor, so an attempt to allowlist a yielding or
session-only tool is rejected here, not silently dropped later.

### 2. Connect the external MCP client

Point your MCP client at `<primer-base-url>/v1/mcp` over the StreamableHTTP
transport. Authenticate with a bearer token minted on the **API Tokens** page
with the `mcp` scope (see the [MCP Server feature](mcp-server) for token
creation), or with a console cookie session.

On connect, the client lists tools and sees **only** the four allowlisted ids -
nothing else from primer's catalogue. That is the exposure gate: a tool you did
not allowlist (for example `workspaces__delete_workspace`) is absent from
`tools/list` and cannot be called.

### 3. Create a session - the external agent offloads the task

The client calls `create_workspace_session` with the workspace, an agent
binding, and the task as the initial instruction. `auto_start: true` runs it
immediately. The call returns the created session, including its `id`.

`tools/call workspaces__create_workspace_session`
```json
{
  "workspace_id": "<your workspace id>",
  "binding": { "kind": "agent", "agent_id": "<your agent id>" },
  "initial_instructions": "Summarise README.md and write the summary to summary.txt.",
  "auto_start": true
}
```

To offload a graph instead of a single agent, bind to a graph and pass its
input:

```json
{
  "workspace_id": "<your workspace id>",
  "binding": { "kind": "graph", "graph_id": "<your graph id>" },
  "graph_input": { "ticket": "INC-1" },
  "auto_start": true
}
```

### 4. Poll for the result

The client polls `get_workspace_session` until the session reaches a terminal
state. The tool returns `{info, status}`; the session is finished when `status`
(and `info.status`) is `ended`, with `info.ended_reason` one of `completed`,
`failed`, or `cancelled`.

`tools/call workspaces__get_workspace_session`
```json
{ "workspace_id": "<your workspace id>", "session_id": "<session id>" }
```

This is the same session row the REST route `GET /v1/sessions/{id}` serves - the
session tools are thin wrappers over it - so a client driving over MCP sees the
identical lifecycle a REST client would. See the
[sessions API reference](api-sessions) for the full lifecycle.

### 5. Read the output

Once the session has ended, the client reads any file the run produced (or the
transcript itself) with `read_workspace_file`. The transcript lives at
`.state/sessions/<session id>/messages.jsonl`; a file the agent wrote lives
wherever the agent put it.

`tools/call workspaces__read_workspace_file`
```json
{ "workspace_id": "<your workspace id>", "path": "summary.txt" }
```

### 6. Cancel a long run

If the external agent decides it no longer needs a result, it cancels the
session. A created or paused session ends immediately; a running one is
preempted at the next safe point. Either way the session converges to terminal
`ended`.

`tools/call workspaces__cancel_workspace_session`
```json
{ "workspace_id": "<your workspace id>", "session_id": "<session id>" }
```

A subsequent `get_workspace_session` shows the session `ended` with
`ended_reason: "cancelled"`.

## Testing

Drive the endpoint exactly as an external client would: connect over the
StreamableHTTP transport, list tools, create a session bound to a trivial agent,
poll it, read it back, and cancel a second one.

Expected outcome (verified):

- **Exposure gate.** `tools/list` returns exactly the four allowlisted ids and
  nothing else; a non-allowlisted workspace tool (such as
  `workspaces__delete_workspace`) is absent.
- **The offloaded session runs.** `create_workspace_session` returns a session
  id; polling `get_workspace_session` reaches `status: "ended"` with
  `ended_reason: "completed"`. The same session read over REST
  (`GET /v1/sessions/{id}`) shows the identical `ended` status - thin-wrapper
  parity between the MCP and REST views.
- **The result is retrievable over MCP.** `read_workspace_file` on the session's
  transcript (or a produced file) returns the agent's output.
- **Cancel is honoured.** A cancelled session converges to terminal `ended`.

The whole flow runs headlessly over the in-process MCP transport, so it is a
faithful stand-in for a real IDE assistant or desktop agent driving primer as a
backend.
