---
slug: cookbook-code-interpreter
title: Sandboxed code interpreter
section: cookbook
summary: "Run untrusted user code inside an isolated container (or Kubernetes) workspace and return the result, with the blast radius confined to the sandbox."
difficulty: advanced
time_minutes: 25
tags: ["workspaces", "container", "kubernetes", "sandbox", "security"]
---

## Goal

A user hands you a snippet of code and wants it run. You do not trust it. Run it
in an **isolated container** (or Kubernetes pod) workspace - not on the host -
and return its output, with the blast radius confined to the sandbox.

This recipe shows the **container workspace backend** driving an agent that
writes the snippet to a file in the sandbox, executes it there, and reports the
result. The isolation is the whole point.

> **This recipe requires a container or Kubernetes backend, and it matters.**
> On the **local** backend a workspace is just a directory on the host, and an
> agent's shell exec runs on the host itself - so untrusted code is **not**
> isolated there. The confinement claim in this recipe holds only on the
> **container** or **kubernetes** backend, where the code runs inside the
> sandbox's own filesystem, process, and network namespaces. Do not run
> untrusted code on a local workspace.

## Ingredients

- **A Docker daemon** reachable over a Unix socket or TCP (or a Kubernetes
  cluster - see [the workspace reference](api-workspaces) for the
  `kubernetes` provider/template variant).
- **A container workspace provider + template** built from a primer-runtime
  image (the sandbox the code runs in).
- **A `code-runner` agent.** It needs no tool allowlist: the workspace file and
  exec tools (`workspace__write`, `workspace__exec`) are **agent-implicit** on a
  workspace-bound session - they are injected by the workspace binding, so you
  do **not** list them in the agent's `tools` (listing them mis-routes
  `workspace` as a registered toolset and fails the run).

## Walkthrough

### 1. Register the container provider

The provider carries the runtime connection and reachability only; the image and
resource limits live on the template.

`POST /v1/workspace_providers`
```json
{
  "id": "docker-local",
  "provider": "container",
  "config": {
    "kind": "container",
    "runtime": "docker",
    "connection": { "kind": "socket", "socket_path": "/var/run/docker.sock" },
    "reachability": { "kind": "host_port", "bind_host": "127.0.0.1" }
  }
}
```

### 2. Define the sandbox template

A `ContainerTemplateConfig` sets the image plus the sandbox's resource and
network policy. Lock egress down for untrusted code: `network.egress: deny_all`
puts the workspace on a docker `--internal` network (best-effort; see the field
note below).

`POST /v1/workspace_templates`
```json
{
  "id": "code-sandbox",
  "description": "Isolated sandbox for untrusted code.",
  "provider_id": "docker-local",
  "backend": {
    "kind": "container",
    "image": "primer/workspace-runtime:1.0",
    "cpu_cores": 1,
    "memory_bytes": 536870912,
    "network": { "egress": "deny_all" }
  }
}
```

`cpu_cores` / `memory_bytes` cap the sandbox's CPU and RAM. `network.egress`
is best-effort: docker and podman honor it via an `--internal` network;
containerd is CNI-dependent. The host filesystem and host network are out of
reach regardless - that is the container boundary, not a policy toggle.

### 3. Create the `code-runner` agent

`system::create_agent`
```json
{
  "id": "code-runner",
  "description": "Runs untrusted code in the sandbox.",
  "model": {"provider_id": "<llm>", "model_name": "<model>"},
  "tools": [],
  "system_prompt": [
    "You run untrusted user code in the sandbox. Write the snippet to snippet.py, run `python snippet.py`, and report its stdout. Never run anything outside the workspace."
  ]
}
```

Note the **empty `tools`**. The agent still gets `workspace__write` and
`workspace__exec` because the session is workspace-bound; the workspace tools
bypass the allowlist by design.

### 4. Materialise the sandbox and run the code

Create a workspace from the template (the server generates the `ws-<hex>` id and
names the container/volume after it), wait for it to reach `running`, then start
an agent session with the snippet as the instruction.

`POST /v1/workspaces`
```json
{ "template_id": "code-sandbox" }
```

`POST /v1/workspaces/{workspace_id}/sessions`
```json
{
  "binding": { "kind": "agent", "agent_id": "code-runner" },
  "initial_instructions": "Run this code: print(6 * 7)",
  "auto_start": true
}
```

The agent writes the snippet to `/workspace/snippet.py` and execs
`python snippet.py` **inside the container**. Read the produced file back through
the workspace file API - which targets the container's `/workspace` volume - to
collect the result:

`GET /v1/workspaces/{workspace_id}/files/read?path=out.txt&encoding=text`

### 5. Tear down

`DELETE /v1/workspaces/{workspace_id}` removes the container and its volume. The
sandbox - and anything the untrusted code did to it - is gone.

## Testing

Give the agent a deterministic snippet that computes a value, records the
in-container hostname, and probes for the host docker socket, persisting each
fact to a file in `/workspace`:

```python
import socket, os
print('RESULT', 6 * 7)
open('/workspace/out.txt', 'w').write(str(6 * 7))
open('/workspace/sandbox_host.txt', 'w').write(socket.gethostname())
open('/workspace/host_sock.txt', 'w').write(str(os.path.exists('/var/run/docker.sock')))
```

Expected outcome (verified):

- The session ends `completed`.
- **Execution happened in the sandbox.** `out.txt` reads back `42` through the
  file API - the snippet computed `6 * 7` and wrote it to the container's
  `/workspace` volume, so the code ran inside the sandbox, not on the host.
- **Namespace isolation.** `sandbox_host.txt` holds the container's hostname
  (e.g. `da1ee38945dd`), which differs from the host's hostname - the container
  has its own UTS namespace.
- **Mount isolation.** `host_sock.txt` reads `False`: the host docker socket
  (`/var/run/docker.sock`) is absent inside the sandbox, so the untrusted code
  cannot reach the host's container runtime.
- **Clean lifecycle.** After `DELETE`, the workspace `GET` returns `404` and no
  docker container or volume named after the workspace id is left behind.

The same flow runs on the **kubernetes** backend - swap the provider/template
for the `kubernetes` variant (`KubernetesTemplateConfig` with `image`,
`cpu_limit`, `memory_limit`, `pvc_size`) and the code runs in a pod instead of a
container. See [the workspace API reference](api-workspaces) for the Kubernetes
provider and template shapes.
