---
slug: toolsets-python
title: Python Toolsets
section: toolsets
summary: Write a python function, get a callable tool. The docstring is the contract, yielding tools park a run until a human or a timer answers, and every call runs in a sandboxed subprocess.
---

## Concept

A **python toolset** is one python module that you write and primer stores. Every function in it decorated with `@primer_tool` becomes a tool an agent can call, exactly like a built-in or an MCP tool. There is no server to run and nothing to deploy: the source lives in the toolset record, and primer executes it.

This is the third toolset kind, alongside the built-in ones and MCP. Reach for it when the thing you want is a small piece of logic rather than an integration: a calculation, a lookup against a system you already have credentials for, a formatting step, a decision that needs a human in the middle.

### The docstring is the contract

The single idea to hold on to: **primer derives the tool's entire public description from your function, and refuses to register anything ambiguous.**

```python
@primer_tool()
def greet(name: str) -> str:
    """Greet a person by name.

    Use when you need a friendly greeting.

    Args:
        name: Who to greet.
    """
    return "hello " + name
```

From that, primer builds:

| Part of the function | Becomes |
|---|---|
| First docstring line | What the tool does, shown to the model |
| `Use when ...` line | When the model should reach for it |
| Parameters and annotations | The argument schema |
| `Args:` entries | Each argument's description |
| `Examples:` entries (optional) | Example calls, validated against the schema |

Registration **fails** rather than guessing. A parameter with no type annotation, a parameter with no `Args:` entry, a missing `Use when` line, or an example that contradicts the schema all stop the toolset from registering, and the error names the offending parameter and line.

```callout:info
This strictness is the point. A tool whose description is vague is a tool the model calls at the wrong moment. Primer would rather refuse the toolset than ship a bad description to an agent.
```

### The `ctx` parameter

One parameter name is special. If your function takes a parameter called `ctx`, primer injects it and leaves it out of the argument schema, so the model never supplies it. Use it to report progress and to reach the yielding helpers.

### Yielding tools

A tool that needs to wait does not block a worker. It **parks** the run and resumes when the thing it waited for happens. Three helpers park a run:

| Helper | Waits for |
|---|---|
| `ask_user(question)` | An operator to answer |
| `sleep_for(seconds)` | A duration to elapse |
| `watch_files(paths)` | One of those paths to change in the workspace |

A yielding tool needs two functions: the tool itself, and a companion marked `@resumes(<tool>)` that turns the eventual payload into the tool's result. The companion is not itself a tool, so the model never sees it.

```python
@primer_tool()
async def ask_the_operator(question: str, ctx) -> str:
    """Ask the operator a question and wait for the answer.

    Use when a decision needs a human.

    Args:
        question: What to ask.
    """
    return ask_user(question)


@resumes(ask_the_operator)
def _ask_the_operator_resume(payload: dict, meta: dict) -> str:
    """Return the operator's answer.

    Use when resuming the question.

    Args:
        payload: The event payload.
        meta: The resume metadata.
    """
    return payload["response"]
```

Nothing is held open while a run is parked. No process waits, no worker is occupied, and the park survives a restart. See `ref:workspaces/yielding-tools` for what parking means for sessions and claims.

### Sandboxing

Your source is not trusted, even though you wrote it: an agent with toolset-management tools can also write source. Every call runs in a **separate subprocess** with dropped privileges, resource limits, and, where the operating system supports it, a syscall filter.

Primer reports the level it actually enforces, rather than a generic "sandboxed" badge:

| Level | What it enforces |
|---|---|
| `container` | The strongest: the call runs in the workspace container backend |
| `seccomp` | Syscall filter: no exec, no ptrace, and no outbound network unless allowed |
| `sandbox-exec` | The macOS sandbox profile plus resource limits |
| `rlimit-only` | CPU and memory are bounded. Filesystem reads and outbound network are **not** |

```callout:warning
`rlimit-only` is the honest floor, not a failure. It bounds runaway CPU and memory but does not stop a tool reading files the primer process can read, or making outbound connections. The console shows the level beside the editor so you know which one you are on before you trust a tool.
```

Registration itself never executes your module. Primer reads the source structurally to discover the functions, so a module that raises at import time still registers cleanly, and a hostile module cannot run merely by being saved.

### Timeouts

Every tool has a wall-clock bound. Set it per tool with `@primer_tool(timeout_seconds=N)`, or leave it out to use the toolset's default. The ceiling is 300 seconds. A tool that exceeds its bound is killed and returns an error result rather than hanging the run.

## Configuration

```embed:toolsets
```

A python toolset has these settings:

| Field | What it does |
|---|---|
| **id** | How agents and the console refer to the toolset |
| **provider** | `python` |
| **source** | The module. Authored in the console editor, or sent via the API or `primectl` |
| **default_timeout_seconds** | The per-call bound for tools that do not set their own. Defaults to 30, ceiling 300 |
| **allow_network** | Whether outbound connections are permitted. Off by default |

### The console builder

The toolset detail page is a python editor, not a plain text box:

- **Add function** inserts a scaffold with the rules written as `#` comments: one for a plain tool, one for a yielding tool together with its `@resumes` companion. Delete the comments once the shape is familiar.
- **Live validation** runs the real registrar as you type. A missing `Args:` entry is marked on the line that caused it, before you save.
- **Functions** lists what your draft would register, and clicking one jumps to it. Beside it, **Saved and callable** shows what agents can call right now. The two differ exactly while you have unsaved edits.
- **Completions** cover the names primer injects (`primer_tool`, `resumes`, `ask_user`, `sleep_for`, `watch_files`, `ctx`) and the docstring sections, each with a short explanation.

```
 SOURCE   + Add function   3 registered              [ Save ]
+---------------------------------------+  +---------------------+
| 1  @primer_tool()                      |  | Isolation: seccomp  |
| 2  def greet(name: str) -> str:        |  +---------------------+
| 3      """Greet a person by name.      |  | Functions        3  |
| 4                                      |  |  greet     (name)   |
| 5      Use when you need a greeting.   |  |  ask       (question)
| 6                                      |  |     yields          |
| 7      Args:                           |  +---------------------+
| 8          name: Who to greet.         |  | Saved & callable 2  |
| 9      """                             |  |  greet              |
|10      return "hello " + name          |  |  ask                |
+---------------------------------------+  +---------------------+
```

## Walkthrough: your first python tool

1. Open **Toolsets** in the left nav and click **New toolset**.
2. Give it an **id** (for example, `my-tools`) and choose **provider = Python functions**. Click **Create**. The toolset starts empty; nothing is callable yet.
3. On the detail page, click **Add function** and choose **Tool**. A scaffold appears with the contract in comments.
4. Replace the body with what you want. Keep the docstring shape: a first line, a `Use when` line, and one `Args:` entry per parameter.
5. Watch the status beside **Add function**. It reads `1 registered` when the source is valid, or `does not register` with the failing line marked in the gutter.
6. Click **Save**. The tool moves into **Saved and callable**.
7. Bind the toolset to an agent the same way you would any other, and the tool appears in that agent's tool list.

## Walkthrough: a tool that asks a human

1. Click **Add function** and choose **Yielding tool**. Both functions appear: the tool and its `@resumes` companion.
2. Edit the question and the return value. Keep `ctx` in the tool's signature; it is how the tool reaches the yield.
3. Save. The function shows a **yields** badge in the outline.
4. When an agent calls it, the run parks and the question appears in **Approvals**, or wherever the session's channel routes it. Answering it resumes the run and the companion turns your answer into the tool's result.

## What happens after

Once saved, the tools are ordinary tools. They appear in the tool catalogue, bind to agents, count against approval policies, and show up in traces like any other call.

Two behaviours are specific to python toolsets:

**Editing source is versioned.** Every save bumps a `source_version` the server owns, so two people editing at once cannot land on the same number.

**A parked run refuses to resume against edited source.** If you change the module while a run is parked in one of its yielding tools, the resume refuses rather than running the new code against an answer to the old question. That is deliberate: the operator answered the prompt the previous code asked, and silently applying it to different code is worse than stopping.

```callout:tip
Test a tool before binding it to a busy agent. Save it, then call it from a scratch session, and read the trace. A tool that returns a confusing value is harder to debug once several agents depend on it.
```

```ref:toolsets/overview
```

```ref:toolsets/toolsets-approvals
```

```ref:workspaces/yielding-tools
```
