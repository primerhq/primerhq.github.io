---
slug: cli
title: Command-line interface
section: reference
summary: The primer CLI subcommands, their flags, and what each one does.
---

## Top-level

`primer` is a Typer application. Run `--help` on any subcommand for
the full flag list:

```code-tabs:bash
--- bash
primer --help
# Primer microagents framework: API + worker entrypoints.
#
# commands:
#   api      Serve the HTTP API (and an in-process worker by default)
#   worker   Run the worker pool (with a minimal health/workers HTTP surface)
#   init     Run first-time bootstrap. Idempotent; --force re-runs even if completed.
```

## primer api

Starts the FastAPI HTTP server via uvicorn. By default it also starts
an in-process worker pool (`runtime_mode=api+worker`). Pass
`--no-worker` to split API and worker into separate processes.

```code-tabs:bash
--- bash
# Default: API + worker in one process, auto-loads ~/.primer/config.yaml
primer api

# Explicit config file.
primer api --config /etc/primer/config.yaml
primer api -c /etc/primer/config.yaml

# API only; pair with a dedicated `primer worker` process.
primer api --no-worker
```

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--config PATH` | `-c` | `~/.primer/config.yaml` if it exists, else built-in defaults | Path to a YAML config file. |
| `--no-worker` | | off | Serve the API only; do NOT start the in-process worker pool. |

Config file discovery order: explicit `--config` > `~/.primer/config.yaml`
(if present) > built-in defaults (embedded SQLite at
`~/.primer/db/data.sqlite`).

YAML config fields map directly to `AppConfig`. Every field is
optional. Env vars (`PRIMER_*`) override missing YAML fields; a
`--config`-supplied YAML wins over env vars.

```callout:tip
For production deploys, run `primer api --no-worker` and `primer worker`
as two separate processes against the same shared storage. Scaling
workers becomes independent of scaling HTTP capacity.
```

## primer worker

Runs only the worker pool. A minimal HTTP surface (`/v1/health` and
`/v1/workers`) is still served for liveness/readiness probes. Pairs
with a `primer api --no-worker` process.

```code-tabs:bash
--- bash
# Default: auto-loads ~/.primer/config.yaml
primer worker

# Explicit config.
primer worker --config /etc/primer/config.yaml
primer worker -c /etc/primer/config.yaml
```

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--config PATH` | `-c` | `~/.primer/config.yaml` if it exists, else built-in defaults | Path to a YAML config file. |

## primer init

Runs first-time bootstrap. Idempotent: rows that already exist are
skipped. Pass `--force` to re-run the bootstrap even when the
completion marker is already set (useful for partially-failed runs).

```code-tabs:bash
--- bash
# Idempotent bootstrap against default config.
primer init

# Explicit config file.
primer init --config /etc/primer/config.yaml

# Re-run even if bootstrap already completed.
primer init --force
```

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--config PATH` | `-c` | `~/.primer/config.yaml` if it exists, else built-in defaults | Path to a YAML config file. |
| `--force` | | off | Re-run bootstrap even if it has already completed. |

Exit code `1` when any provider bootstraps with errors (printed to
stderr). Exit code `0` when all rows are created or skipped.

## primectl

`primer` runs the server. **`primectl`** is the separate operator CLI that
talks to a running instance over the REST API, so it works against a remote
deployment rather than only the machine you are on.

```callout:info
This page documents the python-toolset commands only. `primectl` has 27
commands across 12 groups (`agent`, `chat`, `session`, `workspace`, `channel`,
`tap`, `config`, and more); the rest are not written up yet. Run
`primectl <group> --help` for those in the meantime.
```

### Pointing it at a server, and authenticating

Every command needs a server and a credential:

```bash
# One-off
primectl --server https://your-host toolset list-python-tools --id my-tools

# Or save a context and stop repeating yourself
primectl config set-context home --server https://your-host --token "$TOKEN"
primectl config use-context home
```

The token is an API token (create one from **Settings -> API tokens** in the
console, or `POST /v1/auth/tokens`). `PRIMER_API_TOKEN` works too. Without
one, commands fail with `not authenticated (401)` -- the console's browser
session is a cookie and does not carry over.

### `toolset create-python`

Register a python module as a toolset.

```bash
primectl toolset create-python --id my-tools --source-file ./tools.py
```

```yaml
id: my-tools
provider: python
config:
  source: "@primer_tool()\ndef greet(name: str) -> str:\n    \"\"\"Greet a person..."
  source_version: 1
  default_timeout_seconds: 30.0
  env: {}
  image: null
  allow_network: false
harness_id: null
```

| Flag | Required | Description |
|---|---|---|
| `--id` | yes | Id for the new toolset |
| `--source-file` | yes | Path to the python module to register |
| `--timeout-seconds` | no | Default ceiling for tools that declare none. Default `30.0` |
| `--allow-network` | no | Permit outbound network from the tools |
| `--dry-run` | no | Read the file without calling the server (see the caveat below) |

The server validates the source before storing it. A module that cannot
register is rejected with `422` and a message naming the offending parameter
and line, so a bad docstring fails here rather than at agent-call time.

```callout:warning
`--dry-run` does **not** validate your module. It reads the file, reports its
size, and prints `ok: true` regardless of whether the source would register --
`primectl` does not depend on primer, so it cannot run the registrar locally.
For a real check before saving, use `POST /v1/toolsets/{id}/validate`, which
runs the actual registrar server-side.
```

### `toolset update-python-source`

Replace an existing toolset's module.

```bash
primectl toolset update-python-source --id my-tools --source-file ./tools.py
```

| Flag | Required | Description |
|---|---|---|
| `--id` | yes | Id of the toolset to edit |
| `--source-file` | yes | Path to the replacement module |
| `--dry-run` | no | Read the file without calling the server |

The server owns `source_version` and bumps it only when the source actually
changes, so a session parked in one of these tools resumes against the code
that parked rather than whatever the source says now.

### `toolset list-python-tools`

Show what a toolset derives, and the isolation level being enforced.

```bash
primectl toolset list-python-tools --id my-tools
```

```yaml
toolset_id: my-tools
isolation_level: seccomp
tools:
- id: greet
  description: 'Greet a person by name.


    Use when you need a friendly greeting.'
  toolset_id: my-tools
  schema:
    type: object
    properties:
      name:
        type: string
```

`isolation_level` is what this deployment enforces, not what the strongest
backend could. See the python toolsets page for what each level covers.

```ref:toolsets/toolsets-python
Write a python function and get a callable tool.
```
