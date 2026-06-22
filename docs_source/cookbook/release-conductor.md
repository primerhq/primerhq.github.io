---
slug: cookbook-release-conductor
title: Release conductor
section: cookbook
summary: "An agent that confirms an ambiguous deploy with a human, then refuses to run the irreversible release until an operator explicitly approves it - approve runs it, reject aborts and records the denial."
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

- **`ask_user`** - the agent pauses the session to ask the operator a question, and
  resumes with the answer.
- **A required tool-approval gate** - a policy that forces an operator decision before
  a named tool can run. Approve and the gated call executes; reject and it returns a
  rejection result and a durable record is written.

This recipe shows both gates firing back to back in one session: first `ask_user`, then
the deploy approval.

## Ingredients

- **An LLM provider.**
- **A `local` workspace** for the session to run in.
- **A deploy tool to gate.** In production this is your real "ship it" action - an MCP
  toolset like `deploy-ops__run_deploy`, or whatever runs your migration. The gate is
  tool-agnostic: it keys on the `(toolset_id, tool_name)` pair, so the mechanism is the
  same whatever the tool does. For a self-contained dry run you can gate the built-in
  `workspaces__write_workspace_file` and treat the written file as the deploy marker.
- **A required tool-approval policy** on that tool (see the
  [tool-approval reference](api-tool-approval)).

## Walkthrough

### 1. Create the release-conductor agent

Give it exactly two tools: `ask_user` to confirm, and the deploy tool. The system
prompt forbids deploying without confirming first.

`system::create_agent`
```json
{
  "id": "release-conductor",
  "description": "Confirms a deploy target with a human, then deploys behind an approval gate.",
  "model": {"provider_id": "<llm>", "model_name": "<model>"},
  "tools": ["system__ask_user", "deploy-ops__run_deploy"],
  "max_tool_turns": 5,
  "system_prompt": ["You are a Release Conductor. If the target or version is ambiguous, call ask_user to confirm the environment and version. Then call run_deploy with the confirmed values. Never deploy without confirming first."]
}
```

### 2. Gate the deploy tool with a required policy

A `required` policy means: every call to that tool pauses the session for an operator
decision before it runs.

`POST /v1/tool_approval_policies`
```json
{
  "id": "tap-run-deploy",
  "toolset_id": "deploy-ops",
  "tool_name": "run_deploy",
  "enabled": true,
  "approval": {"type": "required"},
  "timeout_seconds": 600
}
```

> The resolver caches policies in-process. After creating or changing one, call
> `POST /v1/tool_approval_policies/invalidate` (returns `202`) so a running worker
> picks it up immediately. Note the policy keys on the **bare** pair
> (`toolset_id` + `tool_name`), but the pending-approval echo and the durable record
> report the call's **namespaced** name (`deploy-ops__run_deploy`).

### 3. Start the session ambiguously

`POST /v1/sessions` with an instruction that leaves the target open, so the agent has
to ask.

```json
{"workspace_id": "<workspace>", "agent_id": "release-conductor", "instructions": "Deploy the latest build."}
```

### 4. Answer the `ask_user` pause

The agent calls `ask_user`, and the session parks. Poll `GET /v1/sessions/{id}` until
`parked_status` is `"parked"` and `parked_state.yielded.tool_name` is `"ask_user"`,
then read the question and answer it:

`GET /v1/sessions/{id}/ask_user/pending` returns the `prompt` and a `tool_call_id`.

`POST /v1/sessions/{id}/ask_user/respond`
```json
{"tool_call_id": "<from pending>", "response": "staging, v1.4.2"}
```

The call returns `202`; the session resumes and the agent calls the deploy tool.

### 5. Approve or reject the deploy

The deploy call trips the policy and the session parks again - this time on the approval
gate (`parked_state.yielded.tool_name` is `"_approval"`).

`GET /v1/sessions/{id}/tool_approval/pending` returns the `tool_name`
(`deploy-ops__run_deploy`), `approval_type` (`required`), the `arguments`, and a
`tool_call_id`. Decide:

`POST /v1/sessions/{id}/tool_approval/respond`
```json
{"tool_call_id": "<from pending>", "decision": "approved"}
```
Approve, and the gated tool is re-dispatched and runs for real; the agent reports
success and the session ends `completed`.

```json
{"tool_call_id": "<from pending>", "decision": "rejected", "reason": "change freeze window"}
```
Reject, and the gated call resolves to a rejection result instead of running; the agent
aborts without the deploy side effect, the session ends, and a durable
`ToolApprovalRecord` with `decision: "rejected"` and your `reason` is written as the
denial audit trail.

A few things worth knowing:

- **Two parks, one session.** `ask_user` and the approval gate are independent pauses;
  the session parks, resumes, and parks again. Each is answered on its own REST surface
  (`ask_user/respond` then `tool_approval/respond`), and both return `202`.
- **The human makes the decision, not the model.** The agent only chooses to *call*
  `ask_user` and the deploy tool. Whether the answer says "staging" or the gate is
  approved or rejected is entirely the operator's, over REST.
- **Reject is safe by construction.** On a rejection the gated tool never executes, so
  the irreversible action has no side effect. The denial is recorded - query
  `GET /v1/tool_approval/records?status=rejected` and find the row for your session.

## Testing

A scripted end-to-end test exercises the full loop both ways
(`tests/e2e/test_cookbook_release_conductor.py`, `SMK-COOKBOOK-10`). It runs the
conductor against a real session, answers the `ask_user` pause over REST, then resolves
the approval gate once approved and once rejected, gating the built-in
`workspaces__write_workspace_file` as the stand-in deploy (the written `RELEASE` file is
the observable side effect).

Expected outcome (verified):

- **Approve path:** the transcript
  (`<ws>/.state/sessions/<sid>/messages.jsonl`) shows both the `ask_user` call and the
  deploy call; the deploy `tool_result` succeeded; the session ends
  `status: "ended"`, `ended_reason: "completed"`; and the deploy side effect (the
  `RELEASE` marker) is on disk.
- **Reject path:** the deploy was offered but its `tool_result` is a rejection (carrying
  your `reason`); there is **no** deploy side effect; the session ends; and a
  `ToolApprovalRecord` row exists with `decision: "rejected"`, the namespaced
  `tool_name`, and your `reason`.

Point the gated tool at your real deploy action and you have a release pipeline that
will not ship until a human confirms the target and signs off on the irreversible step.
