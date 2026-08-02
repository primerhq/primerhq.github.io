---
slug: api-toolsets
title: Toolsets API
section: reference
summary: REST endpoints to create, list, update, delete, and introspect toolsets, including MCP stdio and HTTP transports.
---

A toolset is a named collection of tools sourced from either the internal registry or a connected MCP server. Agents reference toolsets by scoped tool ids of the form `<toolset_id>__<tool_name>`.

```ref:toolsets/toolsets-system
What toolsets are and how tools are scoped.
```

```ref:features/mcp-server
Connecting an MCP server as a toolset source.
```

## Endpoints

| Method | Path | Summary |
|--------|------|---------|
| GET | `/v1/toolsets` | List toolsets (offset or cursor pagination) |
| POST | `/v1/toolsets` | Create a toolset |
| GET | `/v1/toolsets/{id}` | Get toolset by id |
| PUT | `/v1/toolsets/{id}` | Replace (full update) a toolset |
| DELETE | `/v1/toolsets/{id}` | Delete a toolset |
| POST | `/v1/toolsets/find` | Filter toolsets by predicate |
| GET | `/v1/toolsets/builtin` | List built-in (internal) toolsets |
| GET | `/v1/toolsets/{id}/tools` | Enumerate live tools exposed by a toolset |
| POST | `/v1/toolsets/{id}/invalidate` | Invalidate the cached toolset provider |
| GET | `/v1/toolsets/{id}/runtime` | Isolation level and derived tools (python toolsets) |
| POST | `/v1/toolsets/{id}/validate` | Dry-run: what candidate source would register (python toolsets) |

## Toolset object

```json
{
  "id": "my-mcp-toolset",
  "provider": "mcp",
  "config": {
    "transport": "stdio",
    "config": {
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {}
    }
  },
  "harness_id": null
}
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `id` | no | string | Identifier (case-sensitive). If omitted, the server assigns a type-prefixed id (e.g. `toolset-3f9a1c8d`). Immutable after creation |
| `provider` | yes | string | `"internal"`, `"mcp"`, or `"python"` |
| `config` | conditional | McpConfig, PythonConfig, or null | Required when `provider` is `"mcp"` (McpConfig) or `"python"` (PythonConfig). Must be omitted for `"internal"` |
| `harness_id` | no | string or null | Set by harness management; mutation via CRUD returns 409 when set |

**McpConfig fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `transport` | yes | `"stdio"` or `"http"` |
| `config` | yes | Transport-specific details; must match `transport` |

**StdioConfig fields** (when `transport` is `"stdio"`):

| Field | Required | Description |
|-------|----------|-------------|
| `command` | yes | Argv list to launch the MCP server subprocess (min 1 element) |
| `env` | no | Environment variables to set when launching the subprocess |

**HttpConfig fields** (when `transport` is `"http"`):

| Field | Required | Description |
|-------|----------|-------------|
| `url` | yes | Base URL of the remote MCP server endpoint (min length 1) |
| `headers` | no | HTTP headers included on every request (e.g. `Authorization`) |
| `oauth` | no | OAuthConfig for OAuth 2.1 (PKCE) flows; overrides any `Authorization` header |

**PythonConfig fields** (when `provider` is `"python"`):

The whole toolset is one python module. Every function in it decorated with
`@primer_tool` becomes a tool.

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `source` | yes | string | The module source. Not a secret; returned in full on read |
| `source_version` | yes | integer >= 1 | Bumped whenever the source changes. **Server-owned**: see below |
| `default_timeout_seconds` | no | number | Wall-clock ceiling for a tool that does not declare its own. Default `30`, must be `> 0` and `<= 300` |
| `env` | no | object | Environment variables for the runner process. **Masked on every read path**, like the MCP stdio env |
| `image` | no | string or null | Container image for the runner on container and Kubernetes backends. Ignored by the local runner, which is stdlib-only by construction |
| `allow_network` | no | boolean | Permit outbound sockets from the tool. Default `false`. Enforceable only above the `rlimit-only` isolation level |

```callout:warning
`allow_network: false` is only enforced where the deployment can enforce it. At the `rlimit-only` isolation level there is no syscall filter, so the flag records intent but does not block egress. Check `GET /v1/toolsets/{id}/runtime` for the level actually in force before relying on it.
```

### `source_version` is owned by the server

You send a `source_version`, but it is advisory: the server decides the
stored value. If the submitted `source` matches what is stored, the version
is left alone; if it differs, the server increments.

This exists because a parked run stamps the version it parked at, and refuses
to resume against a different one. If clients owned the number, two operators
editing concurrently would both send the version they read, and a resume
could not tell which code it was about to run.

## Stdio allowlist

For `transport: stdio`, the MCP provider checks `command[0]` against a server-configured allowlist at the point of first use (not at row create). A command not in the allowlist causes `GET /v1/toolsets/{id}/tools` to return `503 /errors/service-unavailable` with a detail message naming the rejected command. The allowlist is set by the operator via `PRIMER_MCP_STDIO_ALLOWED_COMMANDS`; when it is left unset (the default), the check is disabled and any command is permitted.

The POST succeeds regardless; the rejection is enforced lazily when the MCP session is first opened.

## Create a toolset

`POST /v1/toolsets` - returns `201 Created`.

**Stdio MCP toolset:**

```code-tabs:curl,python,javascript
--- curl
curl -X POST https://your-host/v1/toolsets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "fs-tools",
    "provider": "mcp",
    "config": {
      "transport": "stdio",
      "config": {
        "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      }
    }
  }'
--- python
import httpx
r = httpx.post(
    "https://your-host/v1/toolsets",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "id": "fs-tools",
        "provider": "mcp",
        "config": {
            "transport": "stdio",
            "config": {
                "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            },
        },
    },
)
assert r.status_code == 201
--- javascript
const r = await fetch("/v1/toolsets", {
  method: "POST",
  headers: {"Authorization": `Bearer ${token}`, "Content-Type": "application/json"},
  body: JSON.stringify({
    id: "fs-tools",
    provider: "mcp",
    config: {
      transport: "stdio",
      config: {
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      }
    }
  })
})
```

**HTTP MCP toolset:**

```code-tabs:curl,python,javascript
--- curl
curl -X POST https://your-host/v1/toolsets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "remote-mcp",
    "provider": "mcp",
    "config": {
      "transport": "http",
      "config": {
        "url": "https://mcp.example.com/v1",
        "headers": {"Authorization": "Bearer mcp-token"}
      }
    }
  }'
--- python
import httpx
r = httpx.post(
    "https://your-host/v1/toolsets",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "id": "remote-mcp",
        "provider": "mcp",
        "config": {
            "transport": "http",
            "config": {
                "url": "https://mcp.example.com/v1",
                "headers": {"Authorization": "Bearer mcp-token"},
            },
        },
    },
)
assert r.status_code == 201
--- javascript
const r = await fetch("/v1/toolsets", {
  method: "POST",
  headers: {"Authorization": `Bearer ${token}`, "Content-Type": "application/json"},
  body: JSON.stringify({
    id: "remote-mcp",
    provider: "mcp",
    config: {
      transport: "http",
      config: {
        url: "https://mcp.example.com/v1",
        headers: {Authorization: "Bearer mcp-token"}
      }
    }
  })
})
```

Response `201 Created` - the full toolset object.

**Errors:**
- `409` - a toolset with this `id` already exists
- `422` - validation failed (e.g. `transport` and inner config shape mismatch, empty `id`, integer `id`)

## Get a toolset

`GET /v1/toolsets/{id}` - returns `200 OK` with the toolset object.

```code-tabs:curl,python,javascript
--- curl
curl https://your-host/v1/toolsets/fs-tools \
  -H "Authorization: Bearer $TOKEN"
--- python
import httpx
r = httpx.get("https://your-host/v1/toolsets/fs-tools",
              headers={"Authorization": f"Bearer {token}"})
--- javascript
const r = await fetch("/v1/toolsets/fs-tools", {
  headers: {"Authorization": `Bearer ${token}`}
})
```

**Errors:** `404` if the id does not exist.

## List toolsets

`GET /v1/toolsets` - returns an offset or cursor page of toolset objects.

Query parameters: `limit` (1-200, default 20), `offset` (default 0), `cursor`, `order_by`.

```code-tabs:curl,python,javascript
--- curl
curl "https://your-host/v1/toolsets?limit=50&offset=0" \
  -H "Authorization: Bearer $TOKEN"
--- python
import httpx
r = httpx.get("https://your-host/v1/toolsets",
              headers={"Authorization": f"Bearer {token}"},
              params={"limit": 50, "offset": 0})
page = r.json()
toolsets = page["items"]
--- javascript
const r = await fetch("/v1/toolsets?limit=50&offset=0", {
  headers: {"Authorization": `Bearer ${token}`}
})
const {items, total, length, offset} = await r.json()
```

## Replace a toolset

`PUT /v1/toolsets/{id}` - full replacement; returns `200 OK` with the updated toolset.

The body uses the same schema as `POST`. All fields are replaced; omitted optional fields reset to their defaults.

```code-tabs:curl,python,javascript
--- curl
curl -X PUT https://your-host/v1/toolsets/fs-tools \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "fs-tools",
    "provider": "mcp",
    "config": {
      "transport": "stdio",
      "config": {
        "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/data"]
      }
    }
  }'
--- python
import httpx
r = httpx.put(
    "https://your-host/v1/toolsets/fs-tools",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "id": "fs-tools",
        "provider": "mcp",
        "config": {
            "transport": "stdio",
            "config": {"command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/data"]},
        },
    },
)
--- javascript
await fetch("/v1/toolsets/fs-tools", {
  method: "PUT",
  headers: {"Authorization": `Bearer ${token}`, "Content-Type": "application/json"},
  body: JSON.stringify({
    id: "fs-tools",
    provider: "mcp",
    config: {
      transport: "stdio",
      config: {command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/data"]}
    }
  })
})
```

**Errors:** `404` if not found, `409` if the toolset is managed by a harness.

## Delete a toolset

`DELETE /v1/toolsets/{id}` - returns `204 No Content`. Agents that reference this toolset by scoped tool id are not blocked from existing; their `/status` endpoint flips to `ok=false` until the toolset is recreated.

```code-tabs:curl,python,javascript
--- curl
curl -X DELETE https://your-host/v1/toolsets/fs-tools \
  -H "Authorization: Bearer $TOKEN"
--- python
import httpx
r = httpx.delete("https://your-host/v1/toolsets/fs-tools",
                 headers={"Authorization": f"Bearer {token}"})
assert r.status_code == 204
--- javascript
await fetch("/v1/toolsets/fs-tools", {
  method: "DELETE",
  headers: {"Authorization": `Bearer ${token}`}
})
```

## List tools exposed by a toolset

`GET /v1/toolsets/{id}/tools` - connects to the live MCP provider and returns the current tool list. Returns `200 OK` with the tool enumeration.

For OAuth-protected HTTP toolsets, a `401` response includes an `extensions.auth_url` field for the user consent flow.

```code-tabs:curl,python,javascript
--- curl
curl https://your-host/v1/toolsets/fs-tools/tools \
  -H "Authorization: Bearer $TOKEN"
--- python
import httpx
r = httpx.get("https://your-host/v1/toolsets/fs-tools/tools",
              headers={"Authorization": f"Bearer {token}"})
tools = r.json()
--- javascript
const r = await fetch("/v1/toolsets/fs-tools/tools", {
  headers: {"Authorization": `Bearer ${token}`}
})
const tools = await r.json()
```

**Errors:**
- `401` - OAuth consent required; `extensions.auth_url` contains the redirect URL
- `404` - toolset id not found
- `503` - stdio command not in the server allowlist (`/errors/service-unavailable`)
- `502` - the MCP server returned an error
- `504` - network timeout reaching the MCP server

## Runtime facts about a python toolset

`GET /v1/toolsets/{id}/runtime` - what the toolset actually is on this
deployment: the isolation level being enforced, the tools its source
produced, and any registration failure.

```json
{
  "toolset_id": "my-tools",
  "isolation_level": "seccomp",
  "tools": [
    {
      "id": "greet",
      "toolset_id": "my-tools",
      "description": "Greet a person by name.\n\nUse when you need a friendly greeting.",
      "schema": {"type": "object", "properties": {"name": {"type": "string"}}}
    }
  ],
  "registration_error": null
}
```

| Field | Description |
|-------|-------------|
| `isolation_level` | `"container"`, `"seccomp"`, `"sandbox-exec"`, or `"rlimit-only"`. What this deployment ENFORCES, not what the strongest backend could |
| `tools` | The tools the stored source registered, serialised as `Tool`: `id`, `toolset_id`, `description`, `schema`. Empty when registration failed |
| `registration_error` | `null`, or `{message, field, lineno}` naming what stopped it |

```callout:info
The `tools` here are the serialised `Tool` objects, so they carry the argument schema but not the python-specific facts. If you want to know which tools yield, which line each is defined on, or their per-tool timeouts, use `POST /v1/toolsets/{id}/validate` with the stored source: it reports those.
```

`isolation_level` is deliberately specific rather than a generic "sandboxed"
flag. `rlimit-only` bounds CPU and memory but stops neither filesystem reads
nor egress, and an operator deciding whether to trust a tool needs to know
which of the four they are on.

## Validate candidate source

`POST /v1/toolsets/{id}/validate` - run the registrar against source you have
not saved, and get back what it would register or why it would not.

```json
{"source": "@primer_tool()\ndef greet(name: str) -> str:\n    ..."}
```

**Always returns `200`**, including for source that cannot register. A
half-written function is the normal state of an editor, so an invalid module
is an expected answer here rather than a protocol error. Use `ok` to tell
them apart. (`POST` and `PUT` on the toolset itself still return `422` for
invalid source, because there it is a rejected write.)

```json
{
  "ok": false,
  "tools": [],
  "error": {
    "message": "greet: parameter 'name' is not documented",
    "field": "name",
    "lineno": 4
  }
}
```

On success, each entry in `tools` carries `id`, `fn_name`, `yields`,
`timeout_seconds`, `description`, `args`, and `lineno` (the line of the
`def`, so an editor can jump to it).

```code-tabs:curl,python
--- curl
curl -X POST https://your-host/v1/toolsets/my-tools/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source": "@primer_tool()\ndef f(a: str) -> str:\n    \"\"\"Do it.\n\n    Use when you must.\n\n    Args:\n        a: A.\n    \"\"\"\n    return a\n"}'
--- python
import httpx
r = httpx.post(
    "https://your-host/v1/toolsets/my-tools/validate",
    headers={"Authorization": f"Bearer {token}"},
    json={"source": source},
)
verdict = r.json()
if not verdict["ok"]:
    print(verdict["error"]["message"], "on line", verdict["error"]["lineno"])
```

Nothing is persisted, and the module is never executed: the registrar reads
the source structurally, which is the same property that lets the save path
validate untrusted source safely.

## Invalid python source

Both `POST /v1/toolsets` and `PUT /v1/toolsets/{id}` validate the source
before storing it, and reject a module that cannot register:

```json
{
  "type": "/errors/unprocessable-entity",
  "status": 422,
  "extensions": {
    "error": "invalid_python_toolset",
    "message": "greet: parameter 'name' is not documented",
    "field": "name",
    "lineno": 4
  }
}
```

`field` and `lineno` are in `extensions`, not in `detail`. A client rendering
this next to an editor should read the raw envelope: `detail` carries a
generic status title.

## Errors note

All error responses use the RFC 7807 `ProblemDetails` envelope with `type`, `title`, `status`, `detail`, `instance`, and `extensions` (which includes `request_id` and, for 422 errors, an `errors` array with field paths). See the REST API overview for details.
