---
slug: cookbook-support-desk
title: Omnichannel support desk
section: cookbook
summary: "A support chat that answers from your knowledge base over Slack, Discord, or Telegram, and hands off to a specialist when a question needs one. Set up in the console or with primectl."
difficulty: intermediate
time_minutes: 25
tags: ["chats", "channels", "knowledge", "handoff", "support"]
---

## Goal

Let customers (or coworkers) ask questions in the chat tool they already use,
Slack, Discord, or Telegram, and get answers grounded in your knowledge base,
with a clean handoff to a specialist when the front-line agent is out of its
depth. This is the **chat** surface (multi-turn, channel-driven) sitting on top
of the same KB Q&A from the [RAG recipe](cookbook-rag-knowledge-base).

Every step below is shown two ways: first **in the console** (which page to
open, what to click), then a **Via the CLI** block with the exact `primectl`
command. Pick whichever you prefer; the two paths build the same desk, and you
can drive the running chat from either the Chats page or `primectl chat`.

## Ingredients

- **An LLM provider** and an **embedding provider** (for the KB).
- A **knowledge base** collection (see the [RAG recipe](cookbook-rag-knowledge-base))
  and a front-line support agent; optionally one or more **specialist** agents to
  hand off to.
- **A channel** with chats enabled (Slack/Discord/Telegram) if you want the desk
  to live in a chat app. You can also drive a chat directly from the console
  Chats page or `primectl chat` without a channel at all.

If you have not connected `primectl` yet, see "Connecting the CLI" in the
[RAG knowledge base](cookbook-rag-knowledge-base) recipe.

## Walkthrough

### 1. Build the KB and the agents

Create the `kb` collection and ingest your support docs (the
[RAG recipe](cookbook-rag-knowledge-base) builds one). Then a front-line agent
that answers from it, and a specialist for escalations.

In the console:

1. Go to **Compute > Agents** and click **New agent**. On **Basic** set **ID**
   to `support-agent` and pick the **LLM provider** + **Model**; on **Tools**
   check `system__search_collection`; on **Advanced** paste the front-line
   prompt. Click **Create**.
2. Repeat for `billing-specialist` with the billing prompt.

Via the CLI:

```
primectl create -f support-agent.yaml
primectl create -f billing-specialist.yaml
```

where `support-agent.yaml` is:

```yaml
kind: agent
spec:
  id: support-agent
  description: Front-line support.
  model:
    provider_id: <llm>
    model_name: <model>
  tools:
    - system__search_collection
  system_prompt:
    - >-
      You are front-line support. Answer from the kb collection (call
      search_collection) and cite the doc. If a question is about billing
      specifics, tell the user you are handing them to a billing specialist.
```

and `billing-specialist.yaml` is:

```yaml
kind: agent
spec:
  id: billing-specialist
  description: Billing specialist.
  model:
    provider_id: <llm>
    model_name: <model>
  tools:
    - system__search_collection
  system_prompt:
    - >-
      You are a billing specialist. Answer billing questions in detail using
      the kb collection.
```

### 2. Enable chats on a channel

Register the channel (see the
[stock-news monitor](cookbook-scheduled-stock-monitor) for the channel-provider
and channel setup) but turn **chats on** and point it at the front-line agent.

In the console:

1. Go to **Channels > Channels** and open (or create) your channel.
2. In the **Chats** block check **Enable chats** and set the **Default agent**
   to `support-agent`. Click **Save**.

Via the CLI:

```
primectl create -f support-channel.yaml
```

where `support-channel.yaml` is:

```yaml
kind: channel
spec:
  id: support
  provider_id: <provider>
  provider: discord
  external_id: <channel-id>
  label: Support
  config:
    chats:
      enabled: true
      default_agent_id: support-agent
```

Now a user messaging that channel opens a chat with `support-agent`; the
channel's chat commands (`/new`, `/agent`, `/switch`, `/list`) manage the
conversation. Toggling chats on takes effect immediately; the channel starts
serving the chat on its next inbound message, no restart needed.

### 3. Open and drive a chat

You do not need a channel to use the desk. The console Chats page (and
`primectl chat`) drive the same chat directly, which is also how you test the
desk before wiring it to Slack or Discord.

In the console:

1. Go to **Chats** and click **New chat**, bound to `support-agent`.
2. Type a question into the composer (for example "how do I reset my
   password?") and send it. The agent calls `search_collection` and replies in
   the thread, citing the source doc.

Via the CLI:

```
primectl create -f support-chat.yaml
primectl chat say <chat-id> "how do I reset my password?"
```

where `support-chat.yaml` is:

```yaml
kind: chat
spec:
  agent_id: support-agent
```

`create -f` prints the new `chat/<id>`. `chat say` appends your message and
wakes the worker to run the turn; read the reply back with
`primectl call chat messages-get <chat-id> --param after_seq=0` once the turn
drains (the chat resource carries both a send and a list operation on
`messages`, so the read-back is the suffixed `messages-get` action).

### 4. Hand off to a specialist

Escalation is just switching the chat's agent. The message history is
preserved, so the specialist picks up with full context.

In the console: open the chat, use the **agent** control in the thread header
to switch it to `billing-specialist`, then ask the billing question in the same
thread.

Via the CLI:

```
primectl chat switch <chat-id> billing-specialist
primectl chat say <chat-id> "how do I get a refund?"
```

The same switch is available in-channel via `/agent billing-specialist`, and an
agent can trigger it itself with a handoff tool.

A few things worth knowing:

- **Chats are channel-driven in production, but drivable directly.** In a
  channel, user turns arrive from Slack/Discord/Telegram. From the console Chats
  page or `primectl chat say`, you append a user turn and the worker drives it
  the same way, which is how the test below exercises the whole desk headlessly.
- **Switching agents auto-rejects any pending gate.** If the front-line agent is
  parked on an approval or question when you hand off, that gate is cancelled so
  the new agent starts clean.
- **Gates degrade to conversation.** When a chat agent asks for approval or asks
  the user a question, it does not park the session; it just asks in the chat,
  and the user's next message is consumed as the answer (see the
  [tiered help desk](cookbook-tiered-help-desk) for the full soft-yield loop).

## Testing

A scripted end-to-end test pins the AUTOMATABLE core of this desk
(`tests/e2e/test_cookbook_support_desk.py`, `SMK-COOKBOOK-05`): a real
embedder-backed KB plus the two agents, each searching the KB and answering
grounded, citing the source. A second test
(`tests/e2e/test_cookbook_support_desk_cli.py`, `SMK-COOKBOOK-CLI-14`) drives
the whole desk over the published CLI path: it creates the agents and a chat
with `primectl create -f`, sends the customer turn with `primectl chat say`,
hands off with `primectl chat switch`, and asks the specialist a billing
question, reading each reply back from the chat transcript. The agents are
scripted (deterministic mock LLM); the embedder, the indexer, and the vector
search are REAL.

Expected outcome (verified):

- **Message to grounded answer:** sending "how do I reset my password?" creates
  a chat bound to `support-agent`, which calls `search_collection` and replies
  citing the password doc (for example *"...go to id.company.com, click 'Forgot
  Password' ... (Source: password.md)"*).
- **Handoff:** switching the chat to `billing-specialist`, then asking "how do I
  get a refund?" in the same thread has the *specialist* independently call
  `search_collection` and answer from the billing doc, the same conversation, a
  new agent, history intact.

The recipe was also verified live end-to-end over Discord: the channel inbound
turn opened the chat, the front-line agent answered into the thread, and the
in-thread `/agent` switch handed off to the specialist. One thing learned the
hard way:

- **`/agent` and the other thread commands only work inside a chat thread.** Run
  from the main channel they reply ephemerally ("run inside a thread"), which
  reads as nothing happening. Switch from inside the thread, from the console
  Chats page, or with `primectl chat switch`.
