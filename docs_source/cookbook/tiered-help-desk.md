---
slug: cookbook-tiered-help-desk
title: Tiered help desk with supervisor sign-off
section: cookbook
summary: "A chat support desk that answers from a knowledge base, asks the customer for a missing detail inline, hands the conversation off to a billing specialist, and gates the refund behind a supervisor's sign-off, all in one chat. Set up in the console or with primectl."
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
tool-approval gates on a **session**, which parks and resumes, a chat handles
them differently: it **soft-yields**. A chat never parks. Each gate degrades to
an ordinary conversational turn, and the customer's (or supervisor's) next
message in the chat is consumed as the answer. That makes the whole desk
drivable over a single chat stream, with no out-of-band park or resume calls.

Every step below is shown two ways: first **in the console** (which page to
open, what to click), then a **Via the CLI** block with the exact `primectl`
command. The running chat can be driven from either the Chats page or
`primectl chat`. If you have not connected `primectl` yet, see "Connecting the
CLI" in the [RAG knowledge base](cookbook-rag-knowledge-base) recipe.

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

Create the `kb` collection and ingest your support docs (the
[RAG recipe](cookbook-rag-knowledge-base) builds one), including a refund-policy
doc. Then the front-line agent (it searches the KB, asks the customer for
anything it is missing, and hands off when the topic turns to billing) and the
specialist (it issues the refund).

In the console: **Compute > Agents > New agent**. Create `frontline` with the
three front-line tools and prompt, then `billing-specialist` with its refund
tool and prompt. On each, set the tools on the **Tools** tab and the prompt on
**Advanced**, then **Create**.

Via the CLI:

```
primectl create -f frontline.yaml
primectl create -f billing-specialist.yaml
```

where `frontline.yaml` is:

```yaml
kind: agent
spec:
  id: frontline
  description: Front-line support.
  model:
    provider_id: <llm>
    model_name: <model>
  tools:
    - system__search_collection
    - system__ask_user
    - system__switch_to_agent
  system_prompt:
    - >-
      You are front-line support. Search the kb collection and answer grounded,
      citing the doc path. If you need a detail (such as the charge amount),
      call ask_user to ask the customer. When the request is a billing action
      like a refund, call switch_to_agent to hand off to the
      billing-specialist.
```

and `billing-specialist.yaml` is:

```yaml
kind: agent
spec:
  id: billing-specialist
  description: Billing specialist; issues refunds.
  model:
    provider_id: <llm>
    model_name: <model>
  tools:
    - billing__issue_refund
  system_prompt:
    - >-
      You are a billing specialist. Issue the refund the customer requested.
      Large refunds require a supervisor sign-off.
```

> The gated action here is `billing__issue_refund`, your real refund tool (an
> MCP toolset, or whatever moves the money). The gate is tool-agnostic: it keys
> on the `(toolset_id, tool_name)` pair, so the mechanism is identical whatever
> the tool does. For a self-contained dry run you can gate any built-in tool and
> treat its result as the refund marker.

### 2. Gate the refund with a required policy

A `required` policy means every call to that tool waits for a supervisor
decision before it runs.

In the console:

1. Go to **Settings > Tool approval policies** and click **New policy**.
2. Set the **Toolset** to `billing` and the **Tool name** to `issue_refund`,
   choose **Required** approval, set a **Timeout** (for example 600 seconds),
   and leave it **Enabled**. Click **Create**.

Via the CLI:

```
primectl create -f tap-issue-refund.yaml
primectl call tool_approval_policy invalidate
```

where `tap-issue-refund.yaml` is:

```yaml
kind: tool_approval_policy
spec:
  id: tap-issue-refund
  toolset_id: billing
  tool_name: issue_refund
  enabled: true
  approval:
    type: required
  timeout_seconds: 600
```

> The resolver caches policies in-process. After creating or changing one, run
> `primectl call tool_approval_policy invalidate` (the console does this for you
> on save) so a running worker picks it up immediately. The policy keys on the
> **bare** pair (`toolset_id` + `tool_name`), but the chat's pending-gate echo
> and the durable record report the call's **namespaced** name
> (`billing__issue_refund`).

### 3. Open a chat on the front-line agent

In the console: go to **Chats**, click **New chat**, and bind it to `frontline`.

Via the CLI:

```
primectl create -f frontline-chat.yaml
```

where `frontline-chat.yaml` is:

```yaml
kind: chat
spec:
  agent_id: frontline
```

`create -f` prints the new `chat/<id>`. Customer turns arrive as chat messages,
from a bound channel in production, or from the Chats composer / `primectl chat
say` directly. The chat row reports `turn_status`, `agent_id`, and
`pending_tool_call`; read it from the Chats page or with
`primectl get chat <chat-id> -r -o json`, and the transcript with
`primectl call chat messages-get <chat-id> --param after_seq=0` (the chat
resource carries both a send and a list operation on `messages`, so the
read-back is the suffixed `messages-get` action).

### 4. The customer asks, and the front-line answers inline

The customer sends "I want a refund for a charge." In the console, type it into
the chat composer. Via the CLI:

```
primectl chat say <chat-id> "I want a refund for a 900 dollar charge."
```

The front-line agent calls `search_collection`, answers grounded on the
refund-policy doc (citing its path), and, needing the amount, calls
`ask_user("What is the charge amount?")`.

This is the **soft-yield**. The question surfaces as an ordinary assistant turn
in the transcript; the chat records a `pending_tool_call` with `mode: "ask_user"`
and returns `turn_status` to `idle`. The chat does **not** park; there is no
`parked_status` on a chat row. The customer's next message is consumed as the
answer, and the front-line turn resumes from there. You can watch this on the
chat row: poll until `pending_tool_call.mode` is `"ask_user"` while
`turn_status` is `"idle"`.

### 5. The customer answers, and the chat hands off

The customer replies "It was 900 dollars." Send it the same way (composer, or
`primectl chat say <chat-id> "It was 900 dollars."`). That message is consumed
as the `ask_user` answer; the front-line agent now sees the amount and calls
`switch_to_agent(agent_id: "billing-specialist", prompt: "...refund of 900...")`.

The handoff repoints the chat: `chat.agent_id` becomes `billing-specialist`, and
the handoff prompt is queued as the specialist's first turn. The shared message
history is preserved; the specialist inherits the whole transcript, including
the original request and the grounded KB answer.

> You can also drive the handoff yourself. In the console, use the agent control
> in the thread header; via the CLI, `primectl chat switch <chat-id>
> billing-specialist`; in-channel, `/agent billing-specialist`. Switching a
> chat's agent while it has a pending gate auto-rejects that gate first, so the
> new agent starts clean.

### 6. The supervisor signs off

The specialist calls `issue_refund`. The required policy trips, and the chat
soft-yields again, this time with `pending_tool_call.mode: "approval"` (and,
again, no park). The pending echo carries the namespaced `tool_name` and the
`approval_type`.

The supervisor resolves it conversationally, with their next message in the
chat (composer, or `primectl chat say <chat-id> "yes"`):

- An **affirmative** reply ("yes", "approve", "ok") runs the gated refund tool
  for real, and a durable approval record with `decision: "approved"` is
  written.
- A **refusal** ("no") resolves the call to a rejection result **without**
  running the tool, so no refund side effect, and records
  `decision: "rejected"`.

Either way the `pending_tool_call` clears and the turn returns to `idle`. The
audit trail lives under the tool-approval records; the console surfaces it on
the chat, and a running worker writes one record per resolved gate.

A few things worth knowing:

- **A chat never parks; it soft-yields.** Every gate, `ask_user` and the
  approval, becomes a conversational turn keyed on the chat. The next message in
  the chat is the answer. There is no `parked_status` on a chat and no separate
  respond call: the chat stream carries both the question and the answer.
- **The human makes the decision, not the model.** The agent only chooses to
  *call* `ask_user`, `switch_to_agent`, and the refund tool. The amount, and
  whether the refund is approved or rejected, come entirely from the customer
  and supervisor messages.
- **Reject is safe by construction.** On a refusal the gated refund never
  executes, so there is no money movement. The denial is recorded for audit.
- **History survives the handoff.** The specialist sees the full prior
  transcript, so it picks up with the customer's original request and the
  front-line answer in context.

## Testing

A scripted end-to-end test exercises the full chat-HITL loop both ways over the
chat WebSocket (`tests/e2e/test_cookbook_tiered_help_desk.py`,
`SMK-COOKBOOK-13`). A second test drives the identical desk over the published
CLI path (`tests/e2e/test_cookbook_tiered_help_desk_cli.py`,
`SMK-COOKBOOK-CLI-15`): it creates the agents, the required policy, and the chat
with `primectl create -f`, sends each customer and supervisor turn with
`primectl chat say`, and asserts the same outcome. Both run against a real
embedder-backed KB: the agents are scripted (deterministic mock LLM) but the
embedder, indexer, and vector search are real, and the approve/reject decision
is operator-driven (the supervisor's message), never scripted into the model.
The gated `issue_refund` is stood in by a built-in tool that runs for real on
approve.

Expected outcome (verified):

- **KB grounding:** the refund query ranks the refund-policy doc first, and the
  front-line answer cites that doc path in the transcript.
- **Soft-yield `ask_user`:** the chat records `pending_tool_call.mode: "ask_user"`
  at `turn_status: "idle"` with no park columns; the inline question shows up as
  an ordinary assistant turn; the customer's next message resumes the turn.
- **Handoff:** the chat's `agent_id` repoints to the billing specialist, and the
  prior history (the original request and the grounded answer) is still in the
  transcript.
- **Approve path:** the supervisor's "yes" runs the gated refund cleanly, and an
  approval record with `decision: "approved"` exists for the chat.
- **Reject path:** the supervisor's "no" leaves the refund un-run (its
  `tool_result` is a refusal), and an approval record with
  `decision: "rejected"` exists for the chat.

Point `billing__issue_refund` at your real refund action and bind the chat to a
channel, and you have a tiered desk that answers from your KB, asks the customer
what it needs, escalates to a specialist, and will not move money until a
supervisor signs off, all inside one conversation.
