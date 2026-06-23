---
slug: cookbook-policy-desk
title: High-precision policy desk
section: cookbook
summary: "A compliance Q&A desk over dense regulatory docs where precision matters: turn on cross-encoder reranking and MMR so the top results are both the right clause and not three near-duplicate paraphrases of the wrong one. Set up in the console or with primectl."
difficulty: intermediate
time_minutes: 25
tags: ["knowledge", "semantic-search", "cross-encoder", "rerank", "mmr", "rag", "compliance"]
---

## Goal

Answer nuanced compliance questions over a dense regulatory corpus where the
*precise* clause matters. Plain vector search is good at topical recall but it
over-rewards keyword density: a verbose, on-topic decoy clause can out-rank the
terse clause that actually answers the question, and near-duplicate paraphrases
of that decoy can flood the top results. This desk turns on the two
retrieval-augmentation toggles primer carries on a collection so the top hits
are both **precise** (a cross-encoder rereads each candidate against the query
and promotes the real answer) and **non-redundant** (MMR drops near-duplicate
chunks).

This recipe extends the [RAG knowledge base](cookbook-rag-knowledge-base): same
collection + `search_collection` shape, with the collection's `search` config
switched on. The pipeline runs `vector -> cross-encoder rerank -> MMR`. As in
that recipe, every step is shown **in the console** first, then **Via the CLI**.

## Ingredients

- **An LLM provider** and an **embedding provider** (the collection embeds
  documents for the first-pass vector retrieval).
- A **semantic search provider** (for example pgvector).
- A **cross-encoder provider** (a local HuggingFace reranker such as
  `cross-encoder/ms-marco-MiniLM-L-6-v2` or `BAAI/bge-reranker-v2-m3` works well
  and needs no API key).
- A **collection** whose `search` config points at that cross-encoder and turns
  on MMR.
- A **policy-desk agent** with `system__search_collection`.

If you have not connected `primectl` yet, see "Connecting the CLI" in the
[RAG knowledge base](cookbook-rag-knowledge-base) recipe. The embedding provider
and semantic search provider are created exactly as in that recipe; this recipe
focuses on the cross-encoder and the collection search config.

## Walkthrough

### 1. Register the cross-encoder provider

The reranker is its own provider, like an embedder or an LLM. A local
HuggingFace cross-encoder downloads its model on first use; public reranker
models need no token.

In the console:

1. Go to **Providers > Cross-Encoder** and click **New cross-encoder provider**.
2. The **Provider** is `huggingface`; add your reranker model (for example
   `cross-encoder/ms-marco-MiniLM-L-6-v2`) under **Models**, and leave the token
   blank for a public model.
3. Click **Create**.

Via the CLI:

```
primectl create -f cross-encoder.yaml
```

```yaml
kind: cross_encoder_provider
spec:
  id: ce-1
  provider: huggingface
  models:
    - name: cross-encoder/ms-marco-MiniLM-L-6-v2
  config:
    token: null
  limits:
    max_concurrency: 1
```

### 2. Create the collection with rerank + MMR on

The `search` block is what makes this desk high-precision. `cer` points at the
cross-encoder provider you just created and tunes how deep the rerank pool is;
`mmr` turns on diversification. Leave `search` off and you get plain vector
ranking, which is the only difference.

In the console:

1. Go to **Knowledge > Collections** and click **New collection**.
2. Set **ID** to `policy-kb`, pick the **Embedding provider** + **Embedding model**
   and your **Search provider** (as in the RAG recipe).
3. In the **Search config** block, check **Cross-encoder reranker (CER)** and pick
   the `ce-1` provider + its model, and set **top_n** (for example `50`). Then
   check **MMR diversification** and set **lambda_mult** to `0.5` and **fetch_k**
   to `50`.
4. Click **Create**.

Via the CLI:

```
primectl create -f policy-kb.yaml
```

```yaml
kind: collection
spec:
  id: policy-kb
  description: High-precision compliance knowledge base.
  embedder:
    provider_id: embedder
    model: <embed-model>
  search_provider_id: kb-vectors
  search:
    cer:
      provider_id: ce-1
      model: cross-encoder/ms-marco-MiniLM-L-6-v2
      top_n: 50
      batch_size: 32
    mmr:
      lambda_mult: 0.5
      fetch_k: 50
```

What the knobs mean:

- **`cer.top_n`** is how many vector candidates the cross-encoder scores. The
  searcher overfetches from the vector store to fill this pool. Quality plateaus
  past ~100; latency grows past it.
- **`mmr.lambda_mult`** is the relevance/diversity trade-off. `1.0` is pure
  relevance (vanilla ranking); `0.0` is pure diversity; `0.5` is the conventional
  default and a good start for de-duplicating paraphrases.
- **`mmr.fetch_k`** is how many candidates MMR diversifies over before trimming to
  your top-k. Defaults to `max(50, 10 * k)` when omitted.

### 3. Ingest the policy clauses

Path-addressed, exactly as in the RAG recipe. Each clause is its own document so
citations point at a specific clause path.

In the console: **Knowledge > Documents**, choose `policy-kb`, click
**New document**, set the **Path** (for example `breach-notification.md`) and paste
the clause into **Content**. Repeat for the corpus.

Via the CLI:

```
primectl doc put policy-kb breach-notification.md --content "A personal data breach must be notified to the regulator within 72 hours of discovery."
```

Repeat for the rest of the corpus.

### 4. Create the policy-desk agent

In the console: **Compute > Agents > New agent**. On **Basic** set **ID** to
`policy-desk` and pick the **LLM provider** + **Model**; on **Tools** check
`system__search_collection`; on **Advanced** paste the system prompt (below).
Click **Create**.

Via the CLI:

```
primectl create -f policy-desk.yaml
```

```yaml
kind: agent
spec:
  id: policy-desk
  description: Answers compliance questions over the policy KB with citations.
  model:
    provider_id: <llm>
    model_name: <model>
  tools:
    - system__search_collection
  max_tool_turns: 6
  system_prompt:
    - >-
      You are a compliance policy desk. Answer the question by first calling
      search_collection (collection_id policy-kb) with the user question, then
      answer concisely using only the top reranked hits and cite the clause path
      you used. If nothing relevant is found, say you do not know.
```

The agent calls `search_collection` exactly as it would against a plain
collection; the rerank and MMR happen inside the collection's search pipeline, so
the agent just gets sharper, de-duplicated hits back.

### 5. Ask a question

In the console: **New session**, bind the `policy-desk` agent, pick a workspace,
type the question, and **Create**. Via the CLI:
`primectl session run <workspace-id> --agent policy-desk -i "What is the deadline to notify the regulator of a personal data breach?"`.

A few things worth knowing:

- **Order matters.** The pipeline is `vector -> cross-encoder rerank -> MMR`: the
  cross-encoder needs a relevance-rich pool to re-score, then MMR diversifies the
  small already-relevant set. Reversing it would waste the reranker on
  diverse-but-irrelevant items.
- **Scores change scale after rerank.** Plain vector hits carry a bounded
  similarity (cosine, roughly `0..1`); reranked hits carry the cross-encoder's raw
  logit (can be large or negative). Treat reranked scores as relative within one
  query, not comparable to vector scores.
- **Either toggle is independent.** Set only `cer` for precision, only `mmr` for
  de-duplication, or both. Setting neither preserves plain vector ranking.

## Testing

Seed a corpus with one deliberate trap: a terse clause that is the true answer
to a deadline question (`breach-notification.md`, the 72-hour rule), plus a
verbose *escalation* decoy that is dense with the question's vocabulary
(notify / regulator / breach / deadline) but answers a different question (who
escalates the decision), seeded as three near-duplicate paraphrases. Compare the
ranking with and without the search config (the **Search** button on the
collection detail, or `primectl call collection search <id> -f query.json`). Then
ask:

> "What is the deadline to notify the regulator of a personal data breach?"

Expected outcome (verified end-to-end with a real embedder and a real
HuggingFace cross-encoder):

- **Plain vector gets it wrong.** A control collection with no `search` config
  ranks the verbose escalation decoy **first** and floods the top results with its
  three near-duplicate paraphrases; the precise 72-hour clause is only #2.
- **Rerank fixes the top.** With `cer` on, the cross-encoder rereads each
  candidate against the question and promotes `breach-notification.md` to the
  **#1** spot, a demonstrable reordering of the vector ranking.
- **MMR de-duplicates.** With `mmr` also on, the three near-duplicate escalation
  paraphrases collapse to one and the top-k fills with distinct clauses instead of
  redundant ones.
- The agent answers **from the reranked top clause and cites it**, for example
  *"A personal data breach must be reported within 72 hours. (Source:
  breach-notification.md)"*.

Tune from there: raise `cer.top_n` if the right clause sits deep in the vector
pool, lower `mmr.lambda_mult` toward `0` if near-duplicates still crowd the
results, or push it toward `1` if diversification is dropping a clause you wanted.
To reach the desk from outside primer, expose the agent's `search_collection` tool
over the **MCP server** from **Settings > MCP**; a read-only, non-yielding
answerer is a good fit.
