---
slug: cookbook-incident-responder
title: Webhook incident responder
section: cookbook
summary: "An alert from your monitoring system hits a webhook, which spins up an agent that triages the incident and posts a summary to your channel."
difficulty: intermediate
time_minutes: 20
tags: ["triggers", "webhook", "channels", "incident", "inform"]
---

## Goal

When your monitoring system fires an alert, you want more than a raw page - you want a
first-pass triage waiting in your channel: what broke, how bad, the likely cause, and
a first step. A **webhook** trigger turns the alert into a fresh agent session; the
agent assesses it and posts a summary via `inform_user`.

This recipe shows the **webhook** trigger and passing its payload into the session.

## Ingredients

- **An LLM provider** and **a channel** with a workspace bound to it (see the
  [stock-news monitor](cookbook-scheduled-stock-monitor) for channel + `reply_binding`
  setup).
- Optionally the **web** toolset or workspace file tools so the agent can investigate
  (search the error, read a log) before summarizing.

## Walkthrough

### 1. Create the responder agent

`system::create_agent`
```json
{
  "id": "incident-responder",
  "description": "Triages incidents from alerts and notifies the channel.",
  "model": {"provider_id": "<llm>", "model_name": "<model>"},
  "tools": ["misc__inform_user"],
  "max_tool_turns": 5,
  "system_prompt": ["You are an incident responder. An alert payload is in your input. Assess likely severity, name 1-2 plausible causes and a first step, then call inform_user ONCE with a concise triage summary (service, severity, likely cause, first step). Then stop."]
}
```

### 2. Create a webhook trigger

`POST /v1/triggers`
```json
{"slug": "incident", "name": "Incident webhook", "config": {"kind": "webhook"}, "enabled": true}
```

The created trigger carries a **webhook token** (`config.token`). Its public URL is
`POST /v1/webhooks/{token}` - that is what your monitoring system calls.

### 3. Wire a subscription that carries the alert

The webhook body is exposed to the `payload_template` as `{{ webhook_body }}` (raw
string; `webhook_headers`, `webhook_query`, `webhook_method` are available too). Render
it into the agent's instructions:

`POST /v1/triggers/{trigger-id}/subscriptions`
```json
{
  "config": {"kind": "agent_fresh_session", "agent_id": "incident-responder", "workspace_id": "<channel-bound-workspace>"},
  "payload_template": "Incident alert received: {{ webhook_body }}. Triage it and post a summary."
}
```

A few things worth knowing:

- **The webhook URL is unauthenticated except for the token** - treat the token as a
  secret. For stronger guarantees set `config.hmac_secret`; callers must then send
  `X-Primer-Signature: HMAC-SHA256(secret, body)` or get a 401.
- **`webhook_body` is the raw string**, not parsed JSON - pass it whole (the agent
  reads it fine), or parse fields in the template if your renderer has a JSON filter.
- **Deliver from the agent session.** As in the stock-monitor recipe, `inform_user`
  reaches the channel from an `agent_fresh_session` (returns `delivered_to: 1`); keep
  the notify in the agent, not a graph node.
- **Webhooks are rate-limited and body-capped** (1 MB) server-side.

## Testing

Simulate an alert by POSTing to the webhook:

```
POST /v1/webhooks/{token}
{"service": "payments-api", "error": "5xx error rate 40%, p99 latency 8s", "region": "us-east"}
```

Expected outcome (verified):

- The webhook returns `{"status": "accepted"}` with a `delivery_id`, and **a fresh
  agent session starts** in the bound workspace with the alert as its input (confirmed:
  the POST fired `sess-...` running the responder agent).
- The agent triages the alert and calls `inform_user`, so a summary lands in your
  channel (`delivered_to: 1`, same delivery path proven in the stock-monitor recipe).

Point a real alerting rule (Grafana, Datadog, a uptime checker) at the webhook URL and
you have hands-off first-response triage. Give the agent the `web` toolset and it can
look up the error before summarizing.
