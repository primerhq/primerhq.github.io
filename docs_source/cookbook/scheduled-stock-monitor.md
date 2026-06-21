---
slug: cookbook-scheduled-stock-monitor
title: Scheduled stock-news monitor
section: cookbook
summary: "A scheduled agent that fetches the latest news for a watchlist, judges whether any of it is materially impactful, and alerts a chat channel only when it matters."
difficulty: intermediate
time_minutes: 20
tags: ["triggers", "channels", "web", "scheduled", "inform"]
---

## Goal

Every market morning, pull the latest news for a watchlist, decide whether any of
it could actually move a stock, and send a one-line alert to your team channel -
but stay silent when nothing material happened. A scheduled trigger fires an agent;
the agent searches the web, judges the impact, and posts an alert only when the news
is material.

This recipe combines a **scheduled trigger**, the **web** toolset, and **channel**
delivery via `inform_user`.

## Ingredients

- **An LLM provider** and a **web-search provider** (DuckDuckGo, Tavily, ...).
- **A channel** (Discord, Slack, or Telegram) the bot can post to. This recipe was
  verified with Discord; the others work the same way (a Telegram bot needs you to
  message it once so it has a chat to send to).
- **A workspace with a live backend** whose `reply_binding` points at that channel -
  that is how the agent's `inform_user` calls reach it.
- One agent and a scheduled trigger + subscription.

## Walkthrough

### 1. Register the channel

`system::create_channel_provider`
```json
{"id": "alerts-provider", "provider": "discord", "config": {"bot_token": "<your-bot-token>"}}
```

`system::create_channel` (the `external_id` is the platform's channel/room id)
```json
{"id": "alerts", "provider_id": "alerts-provider", "provider": "discord", "external_id": "<channel-id>", "label": "Stock alerts", "config": {"chats": {"enabled": false}}}
```

### 2. Bind a workspace to the channel

`inform_user` delivers to whatever channel the session's workspace is bound to.

`PUT /v1/workspaces/<workspace-id>/reply_binding`
```json
{"channel_id": "alerts"}
```

The tool returns `{"delivered_to": N}` - the number of channels it reached, so you
can confirm a binding works with a one-line agent that just calls `inform_user`.

### 3. Create the monitor agent

One agent does the whole job: search, judge, and alert. It binds the web toolset and
`misc__inform_user`.

`system::create_agent`
```json
{
  "id": "stock-monitor",
  "description": "Monitors stock news and alerts a channel on material news.",
  "model": {"provider_id": "<llm>", "model_name": "<model>"},
  "tools": ["web__web_search", "misc__inform_user"],
  "max_tool_turns": 8,
  "system_prompt": ["You monitor stock news. The tickers to check are in your input. Use web_search to find recent news for them. Decide whether any of it is materially impactful (likely to move a stock). If it IS material, call inform_user ONCE with a one-line alert naming the tickers and the reason. If nothing is material, do not call inform_user. Then stop."]
}
```

### 4. Schedule it

A scheduled trigger plus an `agent_fresh_session` subscription. The
`payload_template` becomes the agent's instructions (put your watchlist there), and
the subscription's `workspace_id` must be the channel-bound workspace from step 2.

`POST /v1/triggers`
```json
{"slug": "stock-monitor", "name": "Stock news monitor", "config": {"kind": "scheduled", "cron": "0 13 * * 1-5", "timezone": "UTC", "catchup": "none"}, "enabled": true}
```

`POST /v1/triggers/<trigger-id>/subscriptions`
```json
{"config": {"kind": "agent_fresh_session", "agent_id": "stock-monitor", "workspace_id": "<bound-workspace-id>"}, "payload_template": "Check these tickers for material news and alert if material: NVDA, TSLA."}
```

Two things worth knowing:

- **Deliver from a plain agent session, not a graph node.** `inform_user` follows the
  session's workspace `reply_binding` and works from a normal agent session (it
  returns `delivered_to: 1`). A **graph** node's `inform_user` currently does *not*
  reach the channel (it returns `delivered_to: 0`), so keep the alert in a single
  agent driven by `agent_fresh_session`, as above. (If you want the multi-step
  shape - separate fetch / judge / notify - you can still build a graph, but route
  the final delivery through an `agent_fresh_session` step rather than a graph node.)
- **The watched workspace must have a live backend.** A workspace whose backend
  instance is not running rejects sessions; bind the channel to a workspace that is
  actually up.

## Testing

Fire the trigger immediately instead of waiting for the cron:

`POST /v1/triggers/<trigger-id>/fire_now`

Expected outcome (verified):

- The fire returns `{"ok": true}` and starts a fresh agent session in the bound
  workspace, with your watchlist as the instruction.
- The agent makes real web searches for the tickers (you will see live news URLs in
  its tool results).
- **When it judges the news material**, it calls `inform_user` and a message lands in
  your channel (the tool result shows `delivered_to: 1`).
- **When it judges nothing material**, it skips `inform_user` and the run ends
  quietly - exactly the filtering you want: no noise on slow news days.

Run it against a couple of different watchlists to see both paths. Confirm a clean
delivery first with a trivial agent that only calls `inform_user` - if that posts to
your channel, the full monitor will too.
