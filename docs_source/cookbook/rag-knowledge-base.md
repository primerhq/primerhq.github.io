---
slug: cookbook-rag-knowledge-base
title: RAG knowledge base + Q&A
section: cookbook
summary: "Build a searchable knowledge base from your documents and answer questions over it with cited, grounded answers, set up entirely through the console or the primectl CLI."
difficulty: beginner
time_minutes: 15
tags: ["knowledge", "embedding", "semantic-search", "rag"]
---

## Goal

Turn a pile of documents into a knowledge base an agent can answer questions
against, grounded in the source material and citing where each answer came from.
A collection holds and embeds the documents; a Q&A agent searches it with
`search_collection` and answers from the hits.

Every step below is shown two ways: first **in the console** (which page to open,
what to click, which fields to fill), then a **Via the CLI** block with the exact
`primectl` command. Pick whichever you prefer; the two paths build the same
objects.

## Ingredients

- **An LLM provider** and an **embedding provider** (the collection embeds documents
  for semantic search).
- A **semantic search provider** (the vector store, for example pgvector).
- Optionally a **cross-encoder provider** for reranking.
- The **`system`** toolset (for `search_collection`).

### Connecting the CLI (one time)

The console is served by your primer instance; just open it in a browser and log
in. To use the CLI path, point `primectl` at the same instance once. Mint an API
token from **Settings > API tokens** (click **New token**, copy the one-time
plaintext), then:

```
primectl config set-context primer --server https://your-primer.example --token env:PRIMER_API_TOKEN
primectl config use-context primer
```

Set `PRIMER_API_TOKEN` in your shell to the token you copied. From here on,
`primectl get agent`, `primectl create ...`, and friends all talk to that
instance. Run `primectl api-resources` to see every resource and its verbs.

## Walkthrough

### 1. Create the embedding provider

The collection needs an embedding model to turn documents into vectors.

In the console:

1. Go to **Providers > Embedding** and click **New embedding provider**.
2. Set **Provider** to your embedding backend (for example `openai`), fill in the
   **URL** and **API key**, and add your embedding model under **Models**.
3. Click **Create**.

Via the CLI:

```
primectl create -f embedder.yaml
```

where `embedder.yaml` is:

```yaml
kind: embedding_provider
spec:
  id: embedder
  provider: openai
  models:
    - name: <embed-model>
  config:
    url: <embedding-endpoint>
    api_key: <key>
  limits:
    max_concurrency: 2
```

### 2. Create the semantic search provider

The search provider is the vector store the collection writes embeddings to.

In the console:

1. Go to **Providers > Semantic Search** and click **New Semantic Search provider**.
2. Pick a **Backend** (for example `pgvector`) and fill in the connection fields
   (hostname, port, database, username, password).
3. Click **Create**.

Via the CLI:

```
primectl create -f ssp.yaml
```

```yaml
kind: ssp
spec:
  id: kb-vectors
  provider: pgvector
  config:
    hostname: localhost
    port: 5432
    database: primer
    username: primer
    password: primer
```

### 3. Create the knowledge base collection

The collection binds an embedder and a search provider together; everything you
put into it is embedded and indexed.

In the console:

1. Go to **Knowledge > Collections** and click **New collection**.
2. Set **ID** to `kb`, add a **Description**, pick the **Embedding provider** and
   **Embedding model** you created, and choose your **Search provider**.
3. Leave the search-config toggles (MMR, cross-encoder reranker) off for a plain
   RAG collection. Click **Create**.

Via the CLI:

```
primectl create -f kb.yaml
```

```yaml
kind: collection
spec:
  id: kb
  description: IT support knowledge base for question answering.
  embedder:
    provider_id: embedder
    model: <embed-model>
  search_provider_id: kb-vectors
```

### 4. Ingest the documents

Each document is path-addressed: the path is its identity, so re-ingesting the
same path upserts it and re-runs stay idempotent.

In the console:

1. Go to **Knowledge > Documents**, choose the `kb` collection, and click
   **New document**.
2. Set the **Path** (for example `password.md`), an optional **Title**, and paste
   the document text into **Content**.
3. Click **Create**. Repeat for each document.

Via the CLI:

```
primectl doc put kb password.md --content "To reset your password: open id.company.com, click Forgot Password, enter your employee email, and follow the reset link. Reset links expire after 15 minutes."
```

Repeat `primectl doc put kb <path> --content "..."` (or `--file <localfile>`) for
each document. `primectl doc list kb` shows what is ingested.

To pull content from the web instead, give an ingestion agent the `web` toolset
and have it fetch a page then write it back with `put_document`, and drive that on
a schedule so the index stays fresh (see the
[stock-news monitor](cookbook-scheduled-stock-monitor) for the trigger shape).

### 5. Create the Q&A agent

The agent searches the collection and answers from the hits.

In the console:

1. Go to **Compute > Agents** and click **New agent**.
2. On the **Basic** tab set **ID** to `kb-qa`, add a **Description**, and pick the
   **LLM provider** and **Model**.
3. On the **Tools** tab, filter for `search_collection` and check
   `system__search_collection`.
4. On the **Advanced** tab paste the system prompt (below). Click **Create**.

Via the CLI:

```
primectl create -f kbqa.yaml
```

```yaml
kind: agent
spec:
  id: kb-qa
  description: Answers questions from the KB with citations.
  model:
    provider_id: <llm>
    model_name: <model>
  tools:
    - system__search_collection
  max_tool_turns: 6
  system_prompt:
    - >-
      You answer questions using the kb collection. First call
      search_collection (collection_id kb) with the user question to find
      relevant docs. Then answer concisely using only those docs, and cite the
      document path you used. If nothing relevant is found, say you do not know.
```

### 6. Ask a question

Run the agent in a session and watch it search the KB and answer.

In the console:

1. Click **New session** (top right of the dashboard or the Sessions page).
2. Set the **Binding** to `agent`, pick the `kb-qa` agent, choose a **Workspace**,
   and type your question into **Initial instructions**.
3. Click **Create** and watch the transcript: the agent calls `search_collection`,
   then answers citing the source path.

Via the CLI:

```
primectl session run <workspace-id> --agent kb-qa -i "How do I add a printer in the office?"
```

`session run` creates the session, then polls it to completion and prints the
progress. (If you do not have a workspace yet, create a local one with
`primectl create -f workspace_provider.yaml`, a matching `workspace_template`, then
`primectl create workspace --set template_id=<tpl>`.)

A few things worth knowing:

- **Embedding is asynchronous.** A freshly ingested document is searchable a
  moment later, once the embedder has indexed it; retry the first query if it
  returns nothing.
- **`search_collection` returns scored chunks** (`{document_id, chunk_id, score,
  text, meta}`), highest score first. Grounding the agent in those hits, and
  telling it to cite the source, is what keeps answers honest.
- **Rerank for precision.** Turn on a cross-encoder on the collection to rerank
  the embedding hits before the agent reads them; trade a little latency for
  sharper top results (see the [policy desk](cookbook-policy-desk) recipe).

## Testing

Seed a few docs (a VPN guide, a password-reset guide, a printer guide) and ask the
agent a question that only one of them answers.

> "How do I add a printer in the office?"

Expected outcome (verified):

- The agent calls `search_collection`; the printer guide comes back as the top hit
  (semantic search matches "add a printer" to the printer document even without
  exact keywords, and a password query likewise returns the password doc at a high
  score). You can confirm the ranking yourself with **Search** on the collection
  detail (console) or `primectl call collection search kb -f query.json` where
  `query.json` is `{"query": "how do I add a printer", "top_k": 3}` (CLI).
- The agent answers **from that document and cites it**, for example *"open System
  Settings, choose Printers, click Add, and select FLOOR3-HP ... (Source:
  printer.md)"*.
- Ask something the KB does not cover and confirm it says it does not know rather
  than inventing an answer.

To make the KB reachable from outside primer (an IDE, another agent), expose the
Q&A agent's tools over the **MCP server** from **Settings > MCP**; only
non-yielding, exposable tools surface, so a read-only `search_collection`-backed
answerer is a good fit.
