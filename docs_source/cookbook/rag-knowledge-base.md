---
slug: cookbook-rag-knowledge-base
title: RAG knowledge base + Q&A
section: cookbook
summary: "Build a searchable knowledge base from your documents and answer questions over it with cited, grounded answers."
difficulty: beginner
time_minutes: 15
tags: ["knowledge", "embedding", "semantic-search", "rag"]
---

## Goal

Turn a pile of documents into a knowledge base an agent can answer questions
against - grounded in the source material and citing where each answer came from.
A collection holds and embeds the documents; a Q&A agent searches it with
`search_collection` and answers from the hits.

## Ingredients

- **An LLM provider** and an **embedding provider** (the collection embeds documents
  for semantic search).
- Optionally a **cross-encoder provider** for reranking, and a **web-search /
  web-fetch** provider if you ingest from the web.
- The **`system`** toolset (for `search_collection`, `put_document`).

## Walkthrough

### 1. Create the collection

`system::create_collection`
```json
{
  "id": "kb",
  "description": "IT support knowledge base for question answering.",
  "embedder": {"provider_id": "<embedder>", "model": "<embed-model>"},
  "search_provider_id": "<semantic-search-provider>"
}
```

### 2. Ingest documents

Each document is path-addressed; `path` is a query parameter and the body carries the
content. Re-`PUT`ting the same path upserts it, so re-ingestion stays idempotent.

`PUT /v1/collections/kb/documents?path=password.md`
```json
{"content": "To reset your password: open id.company.com, click Forgot Password, enter your employee email, and follow the reset link. Reset links expire after 15 minutes."}
```

Repeat for each document. To pull content from the web instead, give an ingestion
agent the `web` toolset and have it `web_fetch` a page then `put_document` the cleaned
text - and drive that on a schedule with a `scheduled` trigger + `agent_fresh_session`
subscription so the index stays fresh (see the stock-monitor recipe for the trigger
shape).

### 3. Create the Q&A agent

`system::create_agent`
```json
{
  "id": "kb-qa",
  "description": "Answers questions from the KB with citations.",
  "model": {"provider_id": "<llm>", "model_name": "<model>"},
  "tools": ["system__search_collection"],
  "max_tool_turns": 6,
  "system_prompt": ["You answer questions using the kb collection. First call search_collection (collection_id kb) with the user question to find relevant docs. Then answer concisely using only those docs, and cite the document path you used. If nothing relevant is found, say you do not know."]
}
```

A few things worth knowing:

- **Embedding is asynchronous.** A freshly `put` document is searchable a moment
  later, once the embedder has indexed it - retry the first query if it returns
  nothing.
- **`search_collection` returns scored chunks** (`{document_id, chunk_id, score, text,
  meta}`), highest score first. Grounding the agent in those hits - and telling it to
  cite the source - is what keeps answers honest.
- **Rerank for precision.** Configure a cross-encoder on the collection to rerank the
  embedding hits before the agent reads them; trade a little latency for sharper top
  results.

## Testing

Seed a few docs (a VPN guide, a password-reset guide, a printer guide) and ask the
agent a question that only one of them answers.

> "How do I add a printer in the office?"

Expected outcome (verified):

- The agent calls `search_collection`; the printer guide comes back as the top hit
  (semantic search matches "add a printer" to the printer document even without exact
  keywords - a password query likewise returns the password doc at a high score).
- The agent answers **from that document and cites it**, e.g. *"open System Settings,
  choose Printers, click Add, and select FLOOR3-HP ... (Source: printer.md)"*.
- Ask something the KB does not cover and confirm it says it does not know rather than
  inventing an answer.

To make the KB reachable from outside primer (an IDE, another agent), expose the Q&A
agent's tools over the **MCP server** - only non-yielding, exposable tools surface, so
a read-only `search_collection`-backed answerer is a good fit.
