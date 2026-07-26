# Vector Index

The Vector Index stores embedding vectors and performs profile-scoped
cosine searches. It does not generate embeddings, store chunk content,
combine retrieval sources, or select context for an LLM.

## Boundaries

- `embedding/` generates vectors and advances Text Index revisions.
- `vector-index/` persists vectors and searches them.
- `text-index/` remains the source of chunk content.
- `hybrid-retrieval/` will combine vector and lexical results later.
- the engine creates the LanceDB connection and injects it here.

The LanceDB adapter stores one table per embedding profile. Every write
contains a state row plus vector upserts and deletion tombstones. For an
existing table, the complete batch is applied by one `mergeInsert`
operation keyed by `record_key`.

No SQLite or hash-vector fallback is hidden inside this module. If
LanceDB is unavailable, the engine decides whether vector retrieval is
disabled while lexical retrieval remains available.

## Composition

```ts
const lance =
  new LanceDbVectorIndexFactory()
    .create(connection);

const vectorIndex =
  new VectorIndexFactory()
    .create(lance);
```

Use `vectorIndex.writer` as the `EmbeddingIndexWritePort` supplied to
the embedding synchronizer. Use `vectorIndex.search(...)` with a query
vector produced for the same `EmbeddingProfile`.

## Consistency

Writes are serialized per workspace/root/profile inside one process and
reject an unexpected Text Index revision. The composition root should
use one writer per profile table. Cross-process compare-and-set behavior
is deliberately not claimed by this adapter.

ANN index creation and maintenance are separate operational concerns.
Exact vector search works without making index lifecycle part of the
read/write contract.
