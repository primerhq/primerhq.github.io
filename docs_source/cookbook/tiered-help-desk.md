---
slug: cookbook-tiered-help-desk
title: Tiered help desk with supervisor sign-off
section: cookbook
summary: "A chat support desk that answers from a knowledge base, asks the customer for a missing detail inline, hands the conversation off to a billing specialist, and gates the refund behind a supervisor's sign-off - all in one chat."
difficulty: intermediate
time_minutes: 25
tags: ["chats", "tool-approval", "ask-user", "handoff", "hitl", "support"]
---

## Goal

Run a tiered customer-support desk as a single chat conversation. A front-line
agent answers from your knowledge base; when it needs a detail it does not have,
it asks the customer right there in the chat; when the topic moves to billing it
hands the conversation to a specialist; and when the customer wants a large
refund, the specialist's refund action waits for a supervisor to sign off.

This is the **chat** surface of primer's human-in-the-loop story. Where the
[release conductor](cookbook-release-conductor) drives the same `ask_user` and
tool-approval gates on a **session** - which parks and resumes over REST yield
endpoints - a chat handles them differently: it **soft-yields**. A chat never
parks. Each gate degrades to an ordinary conversational turn, and the customer's
(or supervisor's) next message in the chat is consumed as the answer. That makes
the whole desk drivable over a single chat stream, with no out-of-band park or
resume calls.

## Ingredients

- **An LLM provider** and an **embedding provider** (for the KB).
- A **knowledge base** collection with your support docs (the
  [RAG recipe](cookbook-rag-knowledge-base) builds one), ingested with a
  refund-policy doc and whatever else your desk fields.
- A **front-line agent** with `system__search_collection`, `system__ask_user`,
  and `system__switch_to_agent`.
- A **billing specialist agent** with the refund tool you want to gate.
- A **required tool-approval policy** on that refund tool.
- A **chat** bound to the front-line agent.

## Walkthrough

### 1. Build the KB and the two agents

Create the `kb` collection and ingest your support docs (RAG recipe, steps 1-2),
including a refund-policy doc. Then the front-line agent - it searches the KB,
asks the customer for anything it is missing, and hands off when the topic turns
to billing:

`system::create_agent` (front-line)
```json
{
  "id": "frontline",
  "description": "Front-line support.",
  "model": {"provider_id": "<llm>", "model_name": "<model>"},
  "tools": ["system__search_collection", "system__ask_user", "system__switch_to_agent"],
  "system_prompt": ["You are front-line support. Search the kb collection and answer grounded, citing the doc path. If you need a detail (such as the charge amount), call ask_user to ask the customer. When the request is a billing action like a refund, call switch_to_agent to hand off to the billing-specialist."]
}
```

And the specialist - it issues the refund the customer asked for:

`system::create_agent` (billing specialist)
```json
{
  "id": "billing-specialist",
  "description": "Billing specialist; issues refunds.",
  "model": {"provider_id": "<llm>", "model_name": "<model>"},
  "tools": ["billing__issue_refund"],
  "system_prompt": ["You are a billing specialist. Issue the refund the customer requested. Large refunds require a supervisor sign-off."]
}
```

> The gated action here is `billing__issue_refund` - your real refund tool (an
> MCP toolset, or whatever moves the money). The gate is tool-agnostic: it keys
> on the `(toolset_id, tool_name)` pair, so the mechanism is identical whatever
> the tool does. For a self-contained dry run you can gate any built-in tool and
> treat its result as the refund marker.

### 2. Gate the refund with a required policy

A `required` policy means every call to that tool waits for a supervisor decision
before it runs.

`POST /v1/tool_approval_policies`
```json
{
  "id": "tap-issue-refund",
  "toolset_id": "billing",
  "tool_name": "issue_refund",
  "enabled": true,
  "approval": {"type": "required"},
  "timeout_seconds": 600
}
```

> The resolver caches policies in-process. After creating or changing one, call
> `POST /v1/tool_approval_policies/invalidate` (returns `202`) so a running worker
> picks it up immediately. The policy keys on the **bare** pair (`toolset_id` +
> `tool_name`), but the chat's pending-gate echo and the durable record report the
> call's **namespaced** name (`billing__issue_refund`).

### 3. Open a chat on the front-line agent

`POST /v1/chats`
```json
{"agent_id": "frontline"}
```

The response carries the chat `id`. Customer turns arrive over the chat
WebSocket - `WS /v1/chats/{id}/ws` - and the claim worker drives each turn. The
chat row you can poll with `GET /v1/chats/{id}` reports `turn_status`,
`agent_id`, and `pending_tool_call`; the transcript is `GET /v1/chats/{id}/messages`.

### 4. The customer asks, and the front-line answers inline

The customer sends "I want a refund for a charge" over the WS. The front-line
agent calls `search_collection`, answers grounded on the refund-policy doc
(citing its path), and - needing the amount - calls `ask_user("What is the charge
amount?")`.

This is the **soft-yield**. The question surfaces as an ordinary assistant turn
in the transcript; the chat records a `pending_tool_call` with `mode: "ask_user"`
and returns `turn_status` to `idle`. The chat does **not** park - there is no
`parked_status` on a chat row. The customer's next message is consumed as the
answer, and the front-line turn resumes from there.

You can watch this on the chat row: poll `GET /v1/chats/{id}` until
`pending_tool_call.mode` is `"ask_user"` while `turn_status` is `"idle"`.

### 5. The customer answers, and the chat hands off

The customer replies "It was 900 dollars" over the same WS. That message is
consumed as the `ask_user` answer; the front-line agent now sees the amount and
calls `switch_to_agent(agent_id: "billing-specialist", prompt: "...refund of 900...")`.

The handoff repoints the chat: `chat.agent_id` becomes `billing-specialist`, and
the handoff prompt is queued as the specialist's first turn. The shared message
history is preserved - the specialist inherits the whole transcript, including the
original request and the grounded KB answer. Poll `GET /v1/chats/{id}` until
`agent_id` is `"billing-specialist"`.

> Switching a chat's agent while it has a pending gate auto-rejects that gate
> first, so the new agent starts clean. The same switch is available in-channel
> via `/agent billing-specialist`, or over REST with `POST /v1/chats/{id}/agent`.

### 6. The supervisor signs off

The specialist calls `issue_refund`. The required policy trips, and the chat
soft-yields again - this time with `pending_tool_call.mode: "approval"` (and,
again, no park). The pending echo carries the namespaced `tool_name` and the
`approval_type`.

The supervisor resolves it conversationally, with their next message in the chat:

- An **affirmative** reply ("yes", "approve", "ok") runs the gated refund tool
  for real, and a durable `ToolApprovalRecord` with `decision: "approved"` is
  written.
- A **refusal** ("no") resolves the call to a rejection result **without** running
  the tool - no refund side effect - and records `decision: "rejected"`.

Either way the `pending_tool_call` clears and the turn returns to `idle`. The
audit trail is at `GET /v1/tool_approval/records?status=approved` (or
`rejected`); find the row whose `chat_id` matches your chat.

A few things worth knowing:

- **A chat never parks; it soft-yields.** Every gate - `ask_user` and the
  approval - becomes a conversational turn keyed on the chat. The next message in
  the chat is the answer. There is no `parked_status` on a chat and no separate
  REST respond call: the chat stream carries both the question and the answer.
- **The human makes the decision, not the model.** The agent only chooses to
  *call* `ask_user`, `switch_to_agent`, and the refund tool. The amount, and
  whether the refund is approved or rejected, come entirely from the customer and
  supervisor messages.
- **Reject is safe by construction.** On a refusal the gated refund never
  executes, so there is no money movement. The denial is recorded for audit.
- **History survives the handoff.** The specialist sees the full prior transcript,
  so it picks up with the customer's original request and the front-line answer in
  context.

## Testing

A scripted end-to-end test exercises the full chat-HITL loop both ways
(`tests/e2e/test_cookbook_tiered_help_desk.py`, `SMK-COOKBOOK-13`). It drives the
whole desk over the chat WebSocket against a real embedder-backed KB: the agents
are scripted (deterministic mock LLM) but the embedder, indexer, and vector search
are real, and the approve/reject decision is operator-driven (the supervisor's WS
reply), never scripted into the model. The gated `issue_refund` is stood in by a
built-in tool that runs for real on approve.

Expected outcome (verified):

- **KB grounding:** the refund query ranks the refund-policy doc first, and the
  front-line answer cites that doc path in the transcript.
- **Soft-yield `ask_user`:** the chat records `pending_tool_call.mode: "ask_user"`
  at `turn_status: "idle"` with no park columns; the inline question shows up as an
  ordinary assistant turn; the customer's next message resumes the turn.
- **Handoff:** the chat's `agent_id` repoints to the billing specialist, and the
  prior history (the original request and the grounded answer) is still in the
  transcript.
- **Approve path:** the supervisor's "yes" runs the gated refund cleanly, and a
  `ToolApprovalRecord` with `decision: "approved"` exists for the chat.
- **Reject path:** the supervisor's "no" leaves the refund un-run (its
  `tool_result` is a refusal), and a `ToolApprovalRecord` with
  `decision: "rejected"` exists for the chat.

Point `billing__issue_refund` at your real refund action and bind the chat to a
channel, and you have a tiered desk that answers from your KB, asks the customer
what it needs, escalates to a specialist, and will not move money until a
supervisor signs off - all inside one conversation.
