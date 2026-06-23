---
slug: cookbook-incident-responder
title: Webhook incident responder
section: cookbook
summary: "An alert from your monitoring system hits a webhook, which spins up an agent that triages the incident and posts a summary to your channel, set up entirely through the console or the primectl CLI."
difficulty: intermediate
time_minutes: 20
tags: ["triggers", "webhook", "channels", "incident", "inform"]
---

## Goal

When your monitoring system fires an alert, you want more than a raw page, you want a
first-pass triage waiting in your channel: what broke, how bad, the likely cause, and
a first step. A **webhook** trigger turns the alert into a fresh agent session; the
agent assesses it and posts a summary via `inform_user`.

This recipe shows the **webhook** trigger and passing its payload into the session.
Every step is shown two ways: first **in the console** (which page to open, what to
click, which fields to fill), then a **Via the CLI** block with the exact `primectl`
command. Pick whichever you prefer; the two paths build the same objects.

## Ingredients

- **An LLM provider** and **a channel** with a workspace bound to it (see the
  [stock-news monitor](cookbook-scheduled-stock-monitor) for channel and reply-binding
  setup).
- Optionally the **web** toolset or workspace file tools so the agent can investigate
  (search the error, read a log) before summarizing.

If you have not connected `primectl` yet, see "Connecting the CLI" in the
[RAG knowledge base](cookbook-rag-knowledge-base) recipe.

## Walkthrough

### 1. Create the responder agent

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On **Basic** set **ID** to `incident-responder`, add a **Description**, and pick
   the **LLM provider** and **Model**.
3. On **Tools** check `misc__inform_user`.
4. On **Advanced** paste the system prompt (below) and set **max tool turns** to `5`.
   Click **Create**.

Via the CLI:

```
primectl create -f incident-responder.yaml
```

```yaml
kind: agent
spec:
  id: incident-responder
  description: Triages incidents from alerts and notifies the channel.
  model: { provider_id: <llm>, model_name: <model> }
  tools:
    - misc__inform_user
  max_tool_turns: 5
  system_prompt:
    - >-
      You are an incident responder. An alert payload is in your input. Assess
      likely severity, name 1-2 plausible causes and a first step, then call
      inform_user ONCE with a concise triage summary (service, severity, likely
      cause, first step). Then stop.
```

### 2. Create a webhook trigger

In the console:

1. Go to **Automation > Triggers** and click **New trigger**. Set the **Kind** to
   **Webhook**, give it a slug (`incident`), **Enable** it, and click **Create**.
2. Open the trigger; its detail page shows the **webhook URL**. That public URL is
   `POST /v1/webhooks/{token}`, what your monitoring system calls. Treat the token as
   a secret.

Via the CLI:

```
primectl create -f trigger.yaml
```

```yaml
kind: trigger
spec:
  slug: incident
  name: Incident webhook
  config: { kind: webhook }
  enabled: true
```

The created trigger carries the **webhook token** in `config.token`; read it back
with `primectl get trigger <trigger-id> -o json -r`. The public URL is
`POST /v1/webhooks/{token}`.

### 3. Wire a subscription that carries the alert

The webhook body is exposed to the payload template as `{{ webhook_body }}` (raw
string; `webhook_headers`, `webhook_query`, `webhook_method` are available too).
Render it into the agent's instructions, and point the subscription at the
channel-bound workspace.

In the console:

1. Open the trigger and click **New subscription**. Set the **Action** to
   **agent_fresh_session**, pick the `incident-responder` agent and the
   channel-bound workspace, set the **Payload template** to render the alert (below),
   and click **Create**.

Via the CLI, the subscription is nested under the trigger, so create it with the
`call trigger subscriptions` custom operation (pass the trigger id `create` echoed
back):

```
primectl call trigger subscriptions <trigger-id> -f subscription.yaml
```

```yaml
config: { kind: agent_fresh_session, agent_id: incident-responder, workspace_id: <channel-bound-workspace> }
payload_template: "Incident alert received: {{ webhook_body }}. Triage it and post a summary."
```

A few things worth knowing:

- **The webhook URL is unauthenticated except for the token**, treat the token as a
  secret. For stronger guarantees set `config.hmac_secret`; callers must then send
  `X-Primer-Signature: HMAC-SHA256(secret, body)` or get a 401.
- **`webhook_body` is the raw string**, not parsed JSON, pass it whole (the agent
  reads it fine), or parse fields in the template if your renderer has a JSON filter.
- **Deliver from the agent session.** As in the stock-monitor recipe, `inform_user`
  reaches the channel from an `agent_fresh_session` (returns `delivered_to: 1`); keep
  the notify in the agent, not a graph node.
- **Webhooks are rate-limited and body-capped** (1 MB) server-side.

## Testing

Simulate an alert by POSTing to the webhook. The webhook is a public,
token-authenticated endpoint with no first-class console button or `primectl` verb
(your monitoring system calls it directly), so the simplest hands-on test is `curl`,
or the `primectl raw` escape hatch:

```
primectl raw POST /v1/webhooks/<token> -f alert.json
```

where `alert.json` is:

```json
{"service": "payments-api", "error": "5xx error rate 40%, p99 latency 8s", "region": "us-east"}
```

Expected outcome (verified):

- The webhook returns `202` with `{"status": "accepted"}` and a `delivery_id`, and
  fires the subscription, creating a fresh session from the alert. The fired session
  is created, claimed, and runs to terminal `ended` / `completed` (the dispatch hands
  the fired session to the runner, so it actually executes). Find it on the Sessions
  page filtered to the bound workspace (it is tagged with the trigger id); on the CLI
  the session list takes a `workspace_id` filter through the `primectl raw` escape
  hatch (`primectl raw GET /v1/sessions --param workspace_id=<workspace-id> -o json`).
- The agent triages the alert (the rendered `{{ webhook_body }}` is in its
  instructions) and calls `inform_user`, so a summary lands in your channel (the tool
  result shows `delivered_to: 1`). The alert-to-channel delivery is **verified live**,
  the same path proven in the stock-monitor recipe.

Read the session transcript back with
`primectl workspace files get <workspace-id> .state/sessions/<sid>/messages.jsonl --content`
to confirm the rendered alert and the `inform_user` triage call.

Point a real alerting rule (Grafana, Datadog, an uptime checker) at the webhook URL
and you have hands-off first-response triage. Give the agent the `web` toolset and it
can look up the error before summarizing.
