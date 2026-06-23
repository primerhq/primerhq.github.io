---
slug: cookbook-code-interpreter
title: Sandboxed code interpreter
section: cookbook
summary: "Run untrusted user code inside an isolated container (or Kubernetes) workspace and return the result, with the blast radius confined to the sandbox. Set up in the console or with primectl."
difficulty: advanced
time_minutes: 25
tags: ["workspaces", "container", "kubernetes", "sandbox", "security"]
---

## Goal

A user hands you a snippet of code and wants it run. You do not trust it. Run it
in an **isolated container** (or Kubernetes pod) workspace, not on the host, and
return its output, with the blast radius confined to the sandbox.

This recipe shows the **container workspace backend** driving an agent that
writes the snippet to a file in the sandbox, executes it there, and reports the
result. The isolation is the whole point.

Every step below is shown two ways: first **in the console** (which page to
open, what to fill), then a **Via the CLI** block with the exact `primectl`
command. If you have not connected `primectl` yet, see "Connecting the CLI" in
the [RAG knowledge base](cookbook-rag-knowledge-base) recipe.

> **This recipe requires a container or Kubernetes backend, and it matters.**
> On the **local** backend a workspace is just a directory on the host, and an
> agent's shell exec runs on the host itself, so untrusted code is **not**
> isolated there. The confinement claim in this recipe holds only on the
> **container** or **kubernetes** backend, where the code runs inside the
> sandbox's own filesystem, process, and network namespaces. Do not run
> untrusted code on a local workspace.

## Ingredients

- **A Docker daemon** reachable over a Unix socket or TCP (or a Kubernetes
  cluster, see [the workspace reference](api-workspaces) for the `kubernetes`
  provider/template variant).
- **A container workspace provider + template** built from a primer-runtime
  image (the sandbox the code runs in).
- **A `code-runner` agent.** It needs no tool allowlist: the workspace file and
  exec tools (`workspace__write`, `workspace__exec`) are **agent-implicit** on a
  workspace-bound session, they are injected by the workspace binding, so you do
  **not** list them in the agent's `tools` (listing them mis-routes `workspace`
  as a registered toolset and fails the run).

## Walkthrough

### 1. Register the container provider

The provider carries the runtime connection and reachability only; the image and
resource limits live on the template.

In the console:

1. Go to **Workspaces > Providers** and click **New provider**.
2. Set **Provider** to `container`, the **Runtime** to `docker`, the
   **Connection** to a socket at `/var/run/docker.sock`, and the
   **Reachability** to a host port bound on `127.0.0.1`.
3. Click **Create**.

Via the CLI:

```
primectl create -f docker-provider.yaml
```

where `docker-provider.yaml` is:

```yaml
kind: workspace_provider
spec:
  id: docker-local
  provider: container
  config:
    kind: container
    runtime: docker
    connection:
      kind: socket
      socket_path: /var/run/docker.sock
    reachability:
      kind: host_port
      bind_host: 127.0.0.1
```

### 2. Define the sandbox template

The template sets the image plus the sandbox's resource and network policy. Lock
egress down for untrusted code: `network.egress: deny_all` puts the workspace on
a docker `--internal` network (best-effort; see the field note below).

In the console:

1. Go to **Workspaces > Templates** and click **New template**.
2. Pick the `docker-local` **Provider**, set the backend **Kind** to
   `container`, the **Image** to your primer-runtime image, and the CPU / memory
   caps. In the **Network** block set **Egress** to `deny_all`.
3. Click **Create**.

Via the CLI:

```
primectl create -f code-sandbox.yaml
```

where `code-sandbox.yaml` is:

```yaml
kind: workspace_template
spec:
  id: code-sandbox
  description: Isolated sandbox for untrusted code.
  provider_id: docker-local
  backend:
    kind: container
    image: primer/workspace-runtime:1.0
    cpu_cores: 1
    memory_bytes: 536870912
    network:
      egress: deny_all
```

`cpu_cores` / `memory_bytes` cap the sandbox's CPU and RAM. `network.egress` is
best-effort: docker and podman honor it via an `--internal` network; containerd
is CNI-dependent. The host filesystem and host network are out of reach
regardless, that is the container boundary, not a policy toggle.

### 3. Create the `code-runner` agent

In the console: **Compute > Agents > New agent**. Set **ID** to `code-runner`,
pick the **LLM provider** + **Model**, leave **Tools** empty, and paste the
prompt on **Advanced**. Click **Create**.

Via the CLI:

```
primectl create -f code-runner.yaml
```

where `code-runner.yaml` is:

```yaml
kind: agent
spec:
  id: code-runner
  description: Runs untrusted code in the sandbox.
  model:
    provider_id: <llm>
    model_name: <model>
  tools: []
  system_prompt:
    - >-
      You run untrusted user code in the sandbox. Write the snippet to
      snippet.py, run `python snippet.py`, and report its stdout. Never run
      anything outside the workspace.
```

Note the **empty `tools`**. The agent still gets `workspace__write` and
`workspace__exec` because the session is workspace-bound; the workspace tools
bypass the allowlist by design.

### 4. Materialise the sandbox and run the code

Create a workspace from the template (the server generates the `ws-<hex>` id and
names the container/volume after it), wait for it to reach `running`, then start
an agent session with the snippet as the instruction.

In the console:

1. Go to **Workspaces > Workspaces** and click **New workspace**, choosing the
   `code-sandbox` template. Wait for its phase to reach `running`.
2. Click **New session**, bind the `code-runner` agent, pick that workspace, and
   type the code to run into **Initial instructions**. Click **Create** and
   watch the transcript: the agent writes `snippet.py` and execs it inside the
   container.

Via the CLI:

```
primectl create workspace --set template_id=code-sandbox
primectl session run <workspace-id> --agent code-runner -i "Run this code: print(6 * 7)"
```

`create workspace` prints the new `workspace/<id>`; the workspace boots its
container in the background. `session run` creates the session, then polls it to
completion and prints `ended: completed` when the run finishes. The agent writes
the snippet to `/workspace/snippet.py` and execs `python snippet.py` **inside
the container**.

Read the produced file back through the workspace file API (which targets the
container's `/workspace` volume) to collect the result.

In the console: open the workspace, use the **Files** tab, and read `out.txt`.

Via the CLI:

```
primectl workspace files get <workspace-id> out.txt --content
```

### 5. Tear down

In the console: open the workspace and click **Delete**. Via the CLI:
`primectl delete workspace <workspace-id>`. Either removes the container and its
volume. The sandbox, and anything the untrusted code did to it, is gone.

## Testing

A scripted end-to-end test runs a deterministic snippet that computes a value,
records the in-container hostname, and probes for the host docker socket,
persisting each fact to a file in `/workspace`
(`tests/e2e/test_cookbook_code_interpreter.py`, `SMK-COOKBOOK-15`). A companion
test drives the identical flow over the published CLI path
(`tests/e2e/test_cookbook_code_interpreter_cli.py`, `SMK-COOKBOOK-CLI-17`):
`primectl create -f` the container provider, template, and agent; `primectl
create workspace --set template_id=` the sandbox; `primectl session run` the
snippet; and `primectl workspace files get` each produced file back. Both are
capability-gated on a container backend, so they skip cleanly where docker is
absent.

The snippet:

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
  file API, the snippet computed `6 * 7` and wrote it to the container's
  `/workspace` volume, so the code ran inside the sandbox, not on the host.
- **Namespace isolation.** `sandbox_host.txt` holds the container's hostname
  (for example `da1ee38945dd`), which differs from the host's hostname, the
  container has its own UTS namespace.
- **Mount isolation.** `host_sock.txt` reads `False`: the host docker socket
  (`/var/run/docker.sock`) is absent inside the sandbox, so the untrusted code
  cannot reach the host's container runtime.
- **Clean lifecycle.** After delete, the workspace fetch returns not-found and no
  docker container or volume named after the workspace id is left behind.

The same flow runs on the **kubernetes** backend, swap the provider/template for
the `kubernetes` variant (a `KubernetesTemplateConfig` with `image`,
`cpu_limit`, `memory_limit`, `pvc_size`) and the code runs in a pod instead of a
container. See [the workspace API reference](api-workspaces) for the Kubernetes
provider and template shapes.
