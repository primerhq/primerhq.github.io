---
slug: cookbook-support-desk
title: Omnichannel support desk
section: cookbook
summary: "A support chat that answers from your knowledge base over Slack, Discord, or Telegram, and hands off to a specialist when a question needs one."
difficulty: intermediate
time_minutes: 25
tags: ["chats", "channels", "knowledge", "handoff", "support"]
---

## Goal

Let customers (or coworkers) ask questions in the chat tool they already use - Slack,
Discord, Telegram - and get answers grounded in your knowledge base, with a clean
handoff to a specialist when the front-line agent is out of its depth. This is the
**chat** surface (multi-turn, channel-driven) sitting on top of the same KB Q&A from
the [RAG recipe](cookbook-rag-knowledge-base).

## Ingredients

- **An LLM provider** and an **embedding provider** (for the KB).
- **A channel** with chats enabled (Slack/Discord/Telegram).
- A **knowledge base** collection (see the RAG recipe) and a front-line support agent;
  optionally one or more **specialist** agents to hand off to.

## Walkthrough

### 1. Build the KB and the agents

Create the `kb` collection and ingest your support docs (RAG recipe, steps 1-2). Then
a front-line agent that answers from it, and a specialist for escalations.

`system::create_agent` (front-line)
```json
{"id": "support-agent", "description": "Front-line support.", "model": {"provider_id": "<llm>", "model_name": "<model>"}, "tools": ["system__search_collection"], "system_prompt": ["You are front-line support. Answer from the kb collection (call search_collection) and cite the doc. If a question is about billing specifics, tell the user you are handing them to a billing specialist."]}
```
```json
{"id": "billing-specialist", "description": "Billing specialist.", "model": {"provider_id": "<llm>", "model_name": "<model>"}, "tools": ["system__search_collection"], "system_prompt": ["You are a billing specialist. Answer billing questions in detail using the kb collection."]}
```

### 2. Enable chats on a channel

Register the channel (see the [stock-news monitor](cookbook-scheduled-stock-monitor)
for provider + channel setup) but turn **chats on** and point it at the front-line
agent:

`system::create_channel`
```json
{"id": "support", "provider_id": "<provider>", "provider": "discord", "external_id": "<channel-id>", "label": "Support", "config": {"chats": {"enabled": true, "default_agent_id": "support-agent"}}}
```

Now a user messaging that channel opens a chat with `support-agent`; the channel's chat
commands (`/new`, `/agent`, `/switch`, `/list`) manage the conversation.

### 3. Hand off to a specialist

Escalation is just switching the chat's agent - the message history is preserved, so
the specialist picks up with full context:

`POST /v1/chats/{chat_id}/agent`
```json
{"agent_id": "billing-specialist"}
```

The same switch is available in-channel via `/agent billing-specialist`, and an agent
can trigger it itself with a handoff tool.

A few things worth knowing:

- **Chats are channel-driven.** User turns arrive from the channel, not a REST body -
  there is no "post a message" REST endpoint. You create and bind the chat over REST;
  the conversation happens in Slack/Discord/Telegram.
- **Switching agents auto-rejects any pending gate.** If the front-line agent is parked
  on an approval or question when you hand off, that gate is cancelled so the new
  agent starts clean.
- **Gates degrade to conversation.** When a chat agent asks for approval or asks the
  user a question, it does not park the session - it just asks in the chat, and the
  user's next message is consumed as the answer.

## Testing

The conversational loop runs over a real channel, so a person sends the messages; the
pieces it is built from are individually verified:

- **Chat lifecycle (verified):** `POST /v1/chats {agent_id}` creates a chat bound to
  `support-agent`; `POST /v1/chats/{id}/agent {agent_id: billing-specialist}` hands it
  off (a `GET` confirms `chat.agent_id` flipped and `status` stays `active`, history
  intact).
- **Answering (verified in the RAG recipe):** the bound agent's `search_collection`
  returns the right doc and the agent answers with a citation.
- **Delivery (verified in the stock-monitor recipe):** messages reach the channel.

End to end: message the support channel ("how do I reset my password?"), confirm the
grounded answer arrives, ask a billing question, and confirm `/agent billing-specialist`
(or an agent-initiated handoff) moves the conversation to the specialist.
