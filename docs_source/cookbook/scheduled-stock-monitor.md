---
slug: cookbook-scheduled-stock-monitor
title: Scheduled stock-news monitor
section: cookbook
summary: "A scheduled agent that fetches the latest news for a watchlist, judges whether any of it is materially impactful, and alerts a chat channel only when it matters, set up entirely through the console or the primectl CLI."
difficulty: intermediate
time_minutes: 20
tags: ["triggers", "channels", "web", "scheduled", "inform"]
---

## Goal

Every market morning, pull the latest news for a watchlist, decide whether any of
it could actually move a stock, and send a one-line alert to your team channel,
but stay silent when nothing material happened. A scheduled trigger fires an agent;
the agent searches the web, judges the impact, and posts an alert only when the news
is material.

This recipe combines a **scheduled trigger**, the **web** toolset, and **channel**
delivery via `inform_user`. Every step is shown two ways: first **in the console**
(which page to open, what to click, which fields to fill), then a **Via the CLI**
block with the exact `primectl` command. Pick whichever you prefer; the two paths
build the same objects.

## Ingredients

- **An LLM provider** and a **web-search provider** (DuckDuckGo, Tavily, ...).
- **A channel** (Discord, Slack, or Telegram) the bot can post to. This recipe was
  verified with Discord; the others work the same way (a Telegram bot needs you to
  message it once so it has a chat to send to).
- **A workspace with a live backend** whose reply binding points at that channel,
  that is how the agent's `inform_user` calls reach it.
- One agent and a scheduled trigger plus a subscription.

If you have not connected `primectl` yet, see "Connecting the CLI" in the
[RAG knowledge base](cookbook-rag-knowledge-base) recipe.

## Walkthrough

### 1. Register the channel

The channel is a provider (the bot credentials) plus a channel (the specific
room the bot posts into).

In the console:

1. Go to **Channels > Providers** and click **New channel provider**. Set the
   **Provider** to `discord` (or `slack` / `telegram`), paste the **bot token**,
   and click **Create**.
2. Go to **Channels > Channels** and click **New channel**. Pick the provider you
   just made, set the **External id** to the platform's channel or room id, give it
   a **Label** (`Stock alerts`), leave chats off, and click **Create**.

Via the CLI:

```
primectl create -f channel-provider.yaml
primectl create -f channel.yaml
```

where `channel-provider.yaml` is:

```yaml
kind: channel_provider
spec:
  id: alerts-provider
  provider: discord
  config:
    bot_token: <your-bot-token>
```

and `channel.yaml` is (the `external_id` is the platform's channel or room id):

```yaml
kind: channel
spec:
  id: alerts
  provider_id: alerts-provider
  provider: discord
  external_id: <channel-id>
  label: Stock alerts
  config:
    chats:
      enabled: false
```

### 2. Bind a workspace to the channel

`inform_user` delivers to whatever channel the session's workspace is bound to.

In the console:

1. Open the workspace you will run the monitor in (**Workspaces**, click the row).
2. Go to its **Channels** tab and click **Link channel**.
3. Pick the `alerts` channel and confirm. The tab now shows the reply binding.

Via the CLI, the standing reply binding is set on the workspace with the
`channel binding set` convenience command:

```
primectl channel binding set <workspace-id> alerts
```

`primectl channel binding get <workspace-id>` shows the current binding, and
`primectl channel binding clear <workspace-id>` removes it.

The `inform_user` tool returns `{"delivered_to": N}`, the number of channels it
reached, so you can confirm a binding works with a one-line agent that just calls
`inform_user`.

### 3. Create the monitor agent

One agent does the whole job: search, judge, and alert. It binds the web toolset and
`misc__inform_user`.

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On **Basic** set **ID** to `stock-monitor`, add a **Description**, and pick the
   **LLM provider** and **Model**.
3. On **Tools** check `web__web_search` and `misc__inform_user`.
4. On **Advanced** paste the system prompt (below) and set **max tool turns** to `8`.
   Click **Create**.

Via the CLI:

```
primectl create -f stock-monitor.yaml
```

```yaml
kind: agent
spec:
  id: stock-monitor
  description: Monitors stock news and alerts a channel on material news.
  model: { provider_id: <llm>, model_name: <model> }
  tools:
    - web__web_search
    - misc__inform_user
  max_tool_turns: 8
  system_prompt:
    - >-
      You monitor stock news. The tickers to check are in your input. Use
      web_search to find recent news for them. Decide whether any of it is
      materially impactful (likely to move a stock). If it IS material, call
      inform_user ONCE with a one-line alert naming the tickers and the reason.
      If nothing is material, do not call inform_user. Then stop.
```

### 4. Schedule it

A scheduled trigger plus an `agent_fresh_session` subscription. The
**payload template** becomes the agent's instructions (put your watchlist there),
and the subscription's workspace must be the channel-bound workspace from step 2.

In the console:

1. Go to **Automation > Triggers** and click **New trigger**. Set the **Kind** to
   **Scheduled**, give it a slug (`stock-monitor`), set the **Cron** to
   `0 13 * * 1-5` and the **Timezone**, leave **Catchup** at `none`, **Enable** it,
   and click **Create**.
2. Open the trigger and click **New subscription**. Set the **Action** to
   **agent_fresh_session**, pick the `stock-monitor` agent and the channel-bound
   workspace, set the **Payload template** to your watchlist instruction, and click
   **Create**.

Via the CLI:

```
primectl create -f trigger.yaml
```

```yaml
kind: trigger
spec:
  slug: stock-monitor
  name: Stock news monitor
  config: { kind: scheduled, cron: "0 13 * * 1-5", timezone: UTC, catchup: none }
  enabled: true
```

The subscription is nested under the trigger, so create it with the
`call trigger subscriptions` custom operation (pass the trigger id `create`
echoed back):

```
primectl call trigger subscriptions <trigger-id> -f subscription.yaml
```

```yaml
config: { kind: agent_fresh_session, agent_id: stock-monitor, workspace_id: <bound-workspace-id> }
payload_template: "Check these tickers for material news and alert if material: NVDA, TSLA."
```

Two things worth knowing:

- **Deliver from a plain agent session, not a graph node.** `inform_user` follows the
  session's workspace reply binding and works from a normal agent session (it
  returns `delivered_to: 1`). A **graph** node's `inform_user` currently does *not*
  reach the channel (it returns `delivered_to: 0`), so keep the alert in a single
  agent driven by `agent_fresh_session`, as above. (If you want the multi-step
  shape, separate fetch / judge / notify, you can still build a graph, but route
  the final delivery through an `agent_fresh_session` step rather than a graph node.)
- **The watched workspace must have a live backend.** A workspace whose backend
  instance is not running rejects sessions; bind the channel to a workspace that is
  actually up.

## Testing

You do not have to wait for the cron. Fire the trigger by hand.

In the console, open the trigger and click **Fire now**; the fire result lists the
dispatched session, which you can open from the Sessions page and watch run.

Via the CLI, fire it with the `fire-now` custom operation and read the dispatched
session id off the result:

```
primectl call trigger fire-now <trigger-id> -f empty.json
```

where `empty.json` is `{}`. The fire result's `results[].artefact_id` is the
dispatched agent session id; poll it to terminal with
`primectl get session <session-id> -o json -r`.

Expected outcome (verified):

- The fire starts a fresh agent session in the bound workspace, with your watchlist
  as the instruction, and the session runs to `ended` / `completed`.
- The agent makes real web searches for the tickers (you will see live news URLs in
  its tool results).
- **When it judges the news material**, it calls `inform_user` and a message lands in
  your channel (the tool result shows `delivered_to: 1`).
- **When it judges nothing material**, it skips `inform_user` and the run ends
  quietly, exactly the filtering you want: no noise on slow news days.

Run it against a couple of different watchlists to see both paths. You can read the
session transcript back through the workspace file API with
`primectl workspace files get <workspace-id> .state/sessions/<sid>/messages.jsonl --content`
to confirm whether the alert was raised. Confirm a clean delivery first with a
trivial agent that only calls `inform_user`; if that posts to your channel, the full
monitor will too.
