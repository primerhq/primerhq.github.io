---
slug: cookbook-release-conductor
title: Release conductor
section: cookbook
summary: "An agent that confirms an ambiguous deploy with a human, then refuses to run the irreversible release until an operator explicitly approves it, approve runs it and reject aborts and records the denial, driven from the console or the primectl CLI."
difficulty: intermediate
time_minutes: 20
tags: ["tool-approval", "ask-user", "hitl", "deploy", "sessions"]
---

## Goal

You want to ship a build, but two things must happen first: a human resolves the
ambiguity ("which environment? which version?"), and a human signs off on the
irreversible step before it runs. This is the canonical **irreversible action behind
a human gate** pattern, and it leans on two of primer's human-in-the-loop primitives
on a session:

- **`ask_user`**, the agent pauses the session to ask the operator a question, and
  resumes with the answer.
- **A required tool-approval gate**, a policy that forces an operator decision before
  a named tool can run. Approve and the gated call executes; reject and it returns a
  rejection result and a durable record is written.

This recipe shows both gates firing back to back in one session: first `ask_user`, then
the deploy approval. Every step is shown two ways: first **in the console** (which page
to open, what to click, which fields to fill), then a **Via the CLI** block with the
exact `primectl` command. Pick whichever you prefer; the two paths drive the same
session.

## Ingredients

- **An LLM provider.**
- **A `local` workspace** for the session to run in.
- **A deploy tool to gate.** In production this is your real "ship it" action, an MCP
  toolset like `deploy-ops__run_deploy`, or whatever runs your migration. The gate is
  tool-agnostic: it keys on the `(toolset_id, tool_name)` pair, so the mechanism is the
  same whatever the tool does. For a self-contained dry run you can gate the built-in
  `workspaces__write_workspace_file` and treat the written file as the deploy marker.
- **A required tool-approval policy** on that tool (see the
  [tool-approval reference](api-tool-approval)).

If you have not connected `primectl` yet, see "Connecting the CLI" in the
[RAG knowledge base](cookbook-rag-knowledge-base) recipe.

## Walkthrough

### 1. Create the release-conductor agent

Give it exactly two tools: `ask_user` to confirm, and the deploy tool. The system
prompt forbids deploying without confirming first.

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On **Basic** set **ID** to `release-conductor`, add a **Description**, and pick the
   **LLM provider** and **Model**.
3. On **Tools** check `system__ask_user` and your deploy tool (here
   `workspaces__write_workspace_file`).
4. On **Advanced** paste the system prompt (below) and set **max tool turns** to `5`.
   Click **Create**.

Via the CLI:

```
primectl create -f release-conductor.yaml
```

```yaml
kind: agent
spec:
  id: release-conductor
  description: Confirms a deploy target with a human, then deploys behind an approval gate.
  model: { provider_id: <llm>, model_name: <model> }
  tools:
    - system__ask_user
    - workspaces__write_workspace_file
  max_tool_turns: 5
  system_prompt:
    - >-
      You are a Release Conductor. If the target or version is ambiguous, call
      ask_user to confirm the environment and version. Then deploy by writing the
      RELEASE marker file with the confirmed values. Never deploy without confirming
      first.
```

### 2. Gate the deploy tool with a required policy

A `required` policy means: every call to that tool pauses the session for an operator
decision before it runs.

In the console:

1. Go to **Compute > Approvals** and click **New approval policy**.
2. Set the **Toolset id** to `workspaces` (your deploy tool's toolset), the
   **Tool name** to `write_workspace_file`, and the **approval type** to **required**.
   Set a **timeout** if you like, leave it **enabled**, and click **Create policy**.

Via the CLI:

```
primectl create -f deploy-policy.yaml
```

```yaml
kind: tool_approval_policy
spec:
  id: tap-run-deploy
  toolset_id: workspaces
  tool_name: write_workspace_file
  enabled: true
  approval: { type: required }
  timeout_seconds: 600
```

The resolver caches policies in-process. After creating or changing one, invalidate
the cache so a running worker picks it up immediately, in the console by reopening the
Approvals page (the per-tool badge re-reads policies), and on the CLI with:

```
primectl call tool_approval_policy invalidate
```

Note the policy keys on the **bare** pair (`toolset_id` + `tool_name`), but the
pending-approval echo and the durable record report the call's **namespaced** name
(`workspaces__write_workspace_file`).

### 3. Start the session ambiguously and ride both gates

Start the session with an instruction that leaves the target open, so the agent has to
ask. The agent calls `ask_user` (the session parks), you answer, the agent calls the
deploy tool (the gate trips, the session parks again), and you approve or reject.

In the console:

1. Click **New session** (top right of the dashboard or the Sessions page). Set the
   **Binding** to `agent`, pick `release-conductor`, choose your **Workspace**, type
   `Deploy the latest build.` into **Initial instructions**, and click **Create**.
2. Open the session. When it parks on `ask_user`, the **ask_user** panel shows the
   prompt; type your answer (`staging, v1.4.2`) and submit. The turn resumes.
3. When the deploy call trips the gate, the session parks on the approval. Go to
   **Compute > Approvals** (or use the in-session approval banner): the pending row
   shows the tool name (`workspaces__write_workspace_file`), the arguments, and
   **Approve** / **Reject** buttons.
   - **Approve**, and the gated tool re-dispatches and runs for real; the agent reports
     success and the session ends `completed`.
   - **Reject** (enter a reason such as `change freeze window`), and the gated call
     resolves to a rejection result instead of running; the agent aborts without the
     deploy side effect, the session ends, and a durable rejection record is written.

Via the CLI, `session run --watch` (the default) handles both parks inline: it polls
the session to terminal, surfaces each prompt, and answers it from your scripted flags.
`--answer` feeds a canned `ask_user` reply, and `--yes` auto-approves every approval
gate:

```
primectl session run <workspace-id> --agent release-conductor \
  -i "Deploy the latest build." \
  --answer "staging, v1.4.2" --yes
```

That is the **approve** path end to end: it answers the `ask_user` park with
`staging, v1.4.2`, auto-approves the deploy gate, and watches the session to
`ended: completed`.

For the **reject** path, start without `--yes` and resolve the approval
non-interactively with `session respond` once the session parks on the gate. Start the
run watching only the ask_user park (answer it, then let it park on the gate):

```
primectl session run <workspace-id> --agent release-conductor \
  -i "Deploy the latest build." \
  --answer "staging, v1.4.2" --no-watch
```

then poll `primectl get session <session-id> -o json -r` until `parked_status` is
`parked` on the approval, and reject it:

```
primectl session respond tool-approval <session-id> \
  --decision rejected --reason "change freeze window"
```

(`session respond ask-user <session-id> --response "staging, v1.4.2"` is the matching
one-shot for the ask_user park if you script the poll loop yourself.)

A few things worth knowing:

- **Two parks, one session.** `ask_user` and the approval gate are independent pauses;
  the session parks, resumes, and parks again. `session run --watch` answers both in
  order; `session respond` answers either one-shot.
- **The human makes the decision, not the model.** The agent only chooses to *call*
  `ask_user` and the deploy tool. Whether the answer says "staging" or the gate is
  approved or rejected is entirely the operator's.
- **Reject is safe by construction.** On a rejection the gated tool never executes, so
  the irreversible action has no side effect. The denial is recorded; read it from the
  Approvals page (resolved records are retained). There is no first-class resource for
  the records list, so on the CLI it is the `primectl raw` escape hatch:
  `primectl raw GET /v1/tool_approval/records --param status=rejected -o json`, then
  find the row whose `session_id` is your session.

## Testing

A scripted end-to-end test exercises the full loop both ways
(`tests/e2e/test_cookbook_release_conductor_cli.py`, `SMK-COOKBOOK-CLI-13`). It builds
the conductor and the required policy with `primectl create -f`, then drives the
session HITL with `primectl session run --watch`: the **approve** run uses
`--answer "staging, v1.4.2" --yes` to answer the `ask_user` park and auto-approve the
gate, and the **reject** run answers the `ask_user` park then rejects the gate with
`session respond tool-approval`. It gates the built-in
`workspaces__write_workspace_file` as the stand-in deploy (the written `RELEASE` file
is the observable side effect).

Expected outcome (verified):

- **Approve path:** the transcript
  (`primectl workspace files get <ws> .state/sessions/<sid>/messages.jsonl --content`)
  shows both the `ask_user` call and the deploy call; the deploy `tool_result`
  succeeded; the session ends `ended` / `completed`; and the deploy side effect (the
  `RELEASE` marker) is on disk.
- **Reject path:** the deploy was offered but its `tool_result` is a rejection
  (carrying your `reason`); there is **no** deploy side effect; the session ends; and a
  rejected approval record exists with the namespaced `tool_name` and your `reason`.

Point the gated tool at your real deploy action and you have a release pipeline that
will not ship until a human confirms the target and signs off on the irreversible step.
