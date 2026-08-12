# Hybrid Retrieval

`hybrid-retrieval` finds repository evidence. It does not assemble an LLM
prompt, read complete file contents, choose a model, retry providers, or run
agent tools.

## Responsibilities

- Normalize and validate one retrieval request.
- Query independent lexical, vector, Repo Map, and Repo Graph sources.
- Treat `anchorFilePaths` as extra RepoGraph file-node anchors (not a scope filter).
- Bound every candidate pool.
- Fuse heterogeneous rankings with weighted reciprocal-rank fusion.
- Preserve source contributions and human-readable ranking evidence.
- Apply an optional injected reranker.
- Return explicit partial, cancelled, unavailable, and failed states.
- Reject stale combinations of Workspace Snapshot, Repo Map, and Repo Graph.

## Folder structure

```text
hybrid-retrieval/
├── sources/
│   ├── CodeQueryTokenizer.ts
│   ├── RepoGraphRetrievalSource.ts
│   ├── RepoMapRetrievalSource.ts
│   ├── TextIndexRetrievalSource.ts
│   ├── VectorIndexRetrievalSource.ts
│   └── index.ts
├── tests/
│   └── HybridRetrieval.spec.ts
├── HybridRetrievalError.ts
├── HybridRetrievalFactory.ts
├── HybridRetrievalRequestNormalizer.ts
├── HybridRetriever.ts
├── HybridRetrieverOptionsResolver.ts
├── RetrievalCandidateKeyBuilder.ts
├── RetrievalSourceRegistry.ts
├── WeightedReciprocalRankFusion.ts
├── constants.ts
├── schema.ts
├── types.ts
└── index.ts
```

## Standard construction

```ts
const retrieval =
  new HybridRetrievalFactory().create(
    {
      textIndex,
      vectorIndex,
      embeddingProvider,
    },
    {
      maximumResults: 40,
      failureMode: "best_effort",
    },
  );

const result = await retrieval.retrieve({
  workspace: workspaceId,
  query: userMessage,
  workspaceSnapshotId: snapshot.snapshotId,
  codeIndexChangeToken: graph.codeIndexChangeToken,
  repoMap,
  repoGraph: graph,
  abortSignal,
});
```

`vectorIndex` and `embeddingProvider` are an intentional pair. Configure both
or neither. Vector retrieval is optional; it is not a silent fallback for text
retrieval.

## Failure policy

- `best_effort`: keep valid evidence from surviving sources.
- `required_sources`: fail when a registration marked `required` does not
  complete.
- `all_sources`: fail unless every configured source completes.

`minimumSuccessfulSources` is evaluated independently, and failures are
reported through structured warnings and source reports.

## Engine boundary

The future runtime engine owns deadlines, retries, logging, telemetry,
provider selection, cache lifecycle, progress UI, and tracing. It passes an
`AbortSignal` into this module and records the deterministic result.

The following V8 module, `context-selection`, consumes
`HybridRetrievalResult`. It decides which retrieved candidates deserve the
available context budget. It must not repeat repository retrieval.
