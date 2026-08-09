---
slug: introduction
title: Introduction
section: getting-started
summary: What primer is, why it optimizes for context over scale, and what you can build with it.
---

## What primer is

Primer is an unopinionated, batteries included agent orchestration platform with a strong focus on context optimization.

Let's break that down. "Unopinionated" means primer does not force you into one fixed workflow - you compose the pieces yourself. "Batteries included" means LLM providers, workspaces, graphs, channels, and vector search all ship with primer and work together out of the box. "Context-first" means every feature exists to keep each agent's working context small and clean, because that is what makes agents accurate and predictable.

## Why context, not scale

A language model does not read your prompt the way you read a page. It spreads a fixed budget of attention across every token in the context all at once. When your context is tight, the handful of tokens that actually matter get most of that attention. When your context is bloated with stale history, unused tool definitions, and irrelevant background, those same important tokens now compete with thousands of distractors. Each distractor pulls a little attention away, and the signal on the tokens that matter gets thinner. This is sometimes called the "lost in the middle" effect: models retrieve facts well when those facts appear near the start or end of a long input, and noticeably worse when the same facts are buried in the middle.

Primer's core bet is that a small model given a clean, purpose-built context can rival a much larger model on the narrow task that context is built for. That is a hypothesis primer is built to test, not a settled result. The bet is that you often do not need the biggest model, if you give the model you have exactly what it needs and nothing more. The thesis implies that a tightly scoped context is not just a crutch for modest hardware but a lever on any model, large or small.

That same logic applies to frontier models. More parameters let a large model tolerate noisy contexts better, but the attention-dilution problem is structural, not a quirk of small models. A frontier model running on a bloated context is still fighting the same headwind, just with more horsepower. Cleaning up the context makes it better too.

```mermaid
flowchart LR
    subgraph Tight["Tight context"]
        rt[5 relevant tokens] -->|most of the attention| ans1[Confident answer]
    end
    subgraph Bloated["Bloated context"]
        rb[5 relevant tokens] --> ans2[Diluted answer]
        d1[Thousands of distractors] --> ans2
        d2[Stale history] --> ans2
    end
```

## What you can build

Here are the seven things primer is built to let you do:

**Run multiple agent configurations in parallel on the same context** - You can point several different agent configurations at the same conversation and switch between them while the conversation history carries forward. Start a chat with one agent, then swap the same chat to a different agent and continue right where you left off. The conversation context is shared; you are just changing which agent configuration is driving it.

**Build reusable workflows and graphs** - Wire agents into directed graphs that can loop. The most useful pattern is a producer-and-judge feedback loop, where one agent drafts a piece of work and another critiques it, and the loop runs until the judge is satisfied. Graphs let you express multi-step reasoning as structure instead of squeezing it into a single prompt.

**Create knowledgebases through vector databases** - Store documents in collections with embedding-backed semantic search. When an agent needs information, it retrieves only the few most relevant chunks, not the entire document. This keeps injected context tight and keeps retrieval fast.

**Dogfood the platform by building agents that build other agents** - "Dogfooding" here means using primer to build primer: the platform's own agent APIs are what you use to create more agents. An agent can create and run other agents programmatically, so you can grow your fleet from inside primer itself. Build a scaffolding agent that sets up new specialists on demand, or write a meta-agent that composes a custom pipeline for each incoming request.

**Build dynamic agents that search and invoke other agents and tools** - With two meta-tools (search and call), an agent can discover and use any tool or agent in the system without carrying the whole catalog in its context. The agent asks "is there a tool for this?" at runtime, gets a small answer, and calls it. The catalog never bloats the prompt.

**Export harness templates on git repos** - Export a tuned set of agents, graphs, and collections to a git-backed bundle, then share it so others can install it in one step. Think of it as "Helm for primer": your configuration becomes a versioned artifact that a teammate or customer can drop into their own instance and run immediately.

**Connect agents to channels like Slack and Telegram** - Bridge agents to Slack, Telegram, and Discord so they can ask people questions, request approvals, and be triggered directly from a channel message. Long-running work can park and wait for a human response, then resume when the reply comes in.

## How it fits together

Think of primer as a stack of layers, where each layer keeps the one below it from getting cluttered.

Context discipline (tool selection, meta-tools, collections) keeps each agent's prompt lean. Workspaces provide shared state so agents can hand off results without carrying history in their own context. Directed cyclic graphs handle sequencing. Event-driven park-and-resume handles time, freeing compute while work waits on a slow tool or a human. Harnesses handle sharing, packaging a working configuration into a versioned bundle. Web search and approval gates handle the edges where agents reach outside the platform.

```mermaid
flowchart TD
    ctx[Context discipline: tool selection, meta-tools, internal collections]
    ctx --> state[State: workspaces as a shared minimal surface]
    state --> seq[Sequencing: directed cyclic graphs]
    seq --> time[Time: event-driven park and resume]
    time --> share[Sharing: harnesses]
    share --> edge[Edges: web search and approvals]
    edge --> primer[Primer: a microagents orchestration platform]
```

## Graph engineering

Graph engineering reframes how people work with coding agents. Instead of prompting an agent one turn at a time, you design the *structure* it runs inside: which agent handles which step, what runs at the same time, where the run branches on a result, who signs off, and where it circles back. The leverage moves from writing a good prompt to drawing a good graph.

A loop is one shape a graph can take, and the smallest interesting one: two nodes and a condition, a producer and a judge. Most real work is not that shape. It branches on what came back, fans out across a dozen items and rejoins, calls a self-contained sub-graph in the middle, and stops for a human at exactly one step while the rest runs unattended.

Primer's execution model is that graph. You declare a topology of typed nodes, wired by static or conditional edges that route on what a node actually returned, and a Pregel-style executor walks it in supersteps, running every ready node concurrently. Cycles are allowed and bound themselves with an iteration cap.

- **A topology** - the structure is declared, not buried in control flow. Seven node kinds cover the shapes: **agent** nodes, **sub-graph** nodes for composition, **fan-out** and **fan-in** for map-reduce, direct **tool call** nodes, and **begin**/**end** nodes carrying the run's input and output contracts.
- **A clean context per node** - each node is its own agent with its own model profile, tools, and output schema, so what crosses an edge is a value you chose rather than a transcript that accumulated. Splitting a long job into a researcher, an extractor, and a judge is three small contexts instead of one enormous one.
- **A heartbeat** - something that surfaces work on a cadence instead of waiting for you to type. Primer's **triggers** start a fresh agent or graph session, or resume a parked one, on a cron schedule, after a delay, or on a webhook.
- **Isolation** - parallel branches that do not step on each other, and a graph that fans out is parallel by construction. Primer's **workspaces** give each agent its own sandbox (local, container, or Kubernetes) with a persistent, git-backed filesystem.
- **Durable memory** - the model forgets between runs; the repository does not. Primer keeps state in **git-backed workspaces** and in **knowledge collections** that agents retrieve from, so knowledge compounds across runs instead of resetting each time.
- **A maker and a checker** - the agent that wrote the work is a poor judge of it. The producer-judge pattern is just a two-node cycle: one agent drafts, another critiques it against a schema or a rubric, and a conditional edge either delivers, retries, or escalates.
- **Connectors** - a graph has to touch real tools and real people. Primer is an **MCP server** (and an MCP client), and it bridges agents to **Slack, Telegram, and Discord**.
- **A human gate** - approve the risky, let the safe run. Primer gates sensitive tool calls behind **human approvals** and lets a run **park and resume** mid-graph, so it can wait at one node for hours without holding compute.

Primer does not decide the shape for you, and it is built so that you do not have to surrender your judgment to run one. Every node gets a clean, purpose-built context rather than an ever-growing transcript, which is the same context discipline that keeps a single agent accurate, now applied at every step. That is what lets a run go a long time without drifting.

## Next

Ready to see it in action? The quickstart walks you through building a real agent end to end.

```ref:getting-started/quickstart
A hands-on walkthrough: build a blog content assistant end to end.
```
