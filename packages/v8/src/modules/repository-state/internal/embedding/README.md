# Embedding

`embedding` converts Text Index chunks into validated vector records and
synchronizes those records through an injected write port.

It does not own LanceDB, vector search, hybrid retrieval, queues, logging,
telemetry, health UI, or provider selection.

## Boundary

```text
TextIndexReadPort
  -> EmbeddingChangePlanner
  -> EmbeddingGenerator
  -> EmbeddingIndexWritePort
```

The future LanceDB module implements `EmbeddingIndexWritePort`. The future
retrieval module owns vector search.

## File tree

```text
embedding/
├── tests/
│   └── Embedding.spec.ts
├── EmbeddingChangePlanner.ts
├── EmbeddingError.ts
├── EmbeddingFactory.ts
├── EmbeddingGenerator.ts
├── EmbeddingSynchronizer.ts
├── EmbeddingTextPreparer.ts
├── EmbeddingVectorValidator.ts
├── constants.ts
├── index.ts
├── README.md
├── schema.ts
└── types.ts
```

## Important behavior

- A provider exposes an explicit `EmbeddingProfile`.
- The profile ID identifies one exact embedding space.
- A model, dimensionality, pooling, or normalization change requires a new
  profile ID.
- Profiles have independent Text Index checkpoints. A new profile can rebuild
  from revision zero without deleting the previous profile.
- Provider failures never silently switch to another embedding model.
- Provider output count, dimensions, finite values, and non-zero norms are
  validated.
- Input truncation is explicit in warnings and statistics.
- Text Index changes are coalesced by chunk before embedding.
- Missing upsert chunks become vector deletions.
- Vector mutations and checkpoint advancement are one atomic write-port call.
- A caller-provided `updatedAt` keeps synchronization deterministic and easy
  to test.

## Integration

```ts
const embedding =
  new EmbeddingFactory().create(
    {
      provider,
      textIndex:
        textIndex.reader,
      vectorWriter:
        lanceDbWriter,
    },
    {
      generator: {
        batchSize: 32,
        maximumInputCharacters:
          8_000,
      },
      synchronizer: {
        maximumChangesPerBatch:
          500,
        maximumBatchesPerRun:
          100,
      },
    },
  );

const result =
  await embedding
    .synchronizer
    .synchronize({
      workspace:
        workspaceId,
      rootId,
      updatedAt:
        Date.now(),
      abortSignal,
    });
```

The Engine supplies timestamps, cancellation, logging, telemetry, scheduling,
and retry policy around this call.

## Deliberate exclusions

- No `HashEmbeddingProvider` production fallback.
- No automatic provider discovery.
- No database-specific code.
- No vector search.
- No hybrid score fusion.
- No queue or background worker.
- No global model cache.

Those concerns belong in provider adapters, the LanceDB module, retrieval, or
the future V8 Engine.
