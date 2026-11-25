# Embedding

Embedding prepares chunk text, generates vectors, plans changed vectors, and synchronizes vector rows into a vector index. It enables semantic retrieval for Repository Context.

## What This Module Does

- Prepares embedding input text from chunks.
- Calls an injected embedding provider.
- Validates vector dimensions and numeric values.
- Normalizes vectors according to profile settings.
- Plans which chunk vectors need upsert/delete.
- Writes vectors through an embedding index port.
- Reports provider calls, truncation, and synchronization statistics.

## Structure

```text
embedding/
  EmbeddingFactory.ts
  EmbeddingGenerator.ts
  EmbeddingTextPreparer.ts
  EmbeddingVectorValidator.ts
  EmbeddingChangePlanner.ts
  EmbeddingSynchronizer.ts
  EmbeddingError.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `EmbeddingProfile`: stable embedding-space id, provider id, model id, dimensions, and normalization flag.
- `EmbeddingProvider`: provider contract for vector generation.
- `EmbeddingGenerationInput`: chunks and optional abort signal.
- `EmbeddingGenerationResult`: profile, vector records, warnings, statistics, and status.
- `EmbeddingSynchronizerInput`: workspace, root id, update time, and optional abort signal.
- `EmbeddingSynchronizationResult`: status, warnings, statistics, and revision data.
- `EmbeddingIndexWritePort`: vector write/remove contract.

## Technical Details

- The profile id must change when model/dimensions/normalization behavior changes.
- Provider input truncation is reported with warnings.
- `EmbeddingVectorValidator` rejects invalid vector shapes before writes.
- Change planning avoids regenerating unchanged vectors.
- Synchronization can be cancelled with an abort signal.
- Embedding generation is optional in workspace indexing.

## Ownership Boundaries

Owns embedding preparation, generation, validation, change planning, and synchronization.

Does not own chunking, vector search query execution, retrieval fusion, or prompt construction.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-state/internal/embedding
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

EmbeddingGenerationInput -> EmbeddingGenerationResult; EmbeddingSynchronizerInput -> EmbeddingSynchronizationResult:

```json
{
  "prompt": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "workspaceId": "workspace-1",
  "stateToken": "state-abc",
  "targetFile": "src/LoginForm.tsx"
}
```

### Step-By-Step Flow

1. A user sends the real prompt shown above from an editor or chat host.
2. The host attaches workspace id `workspace-1` and the explicit target file `src/LoginForm.tsx`.
3. The module receives the real structure shown in the input block.
4. The module validates schema/version/limits before doing any work.
5. The module extracts the important target: `src/LoginForm.tsx`.
6. The module keeps the user constraint: existing validation and error handling must stay intact.
7. The module performs only its own responsibility and does not cross into neighboring modules.
8. Any budget, path, state, or provider constraint is applied before output is produced.
9. The module records warnings/reason codes instead of hiding degraded behavior.
10. The module returns the realistic output shape shown below.
11. The next pipeline stage consumes that output without reinterpreting raw user text.

### Realistic Output

Embedding generation and synchronization result returns a result like this:

```json
{
  "generation": {
    "schemaVersion": 1,
    "status": "complete",
    "profile": { "id": "text-embedding", "providerId": "openai", "modelId": "text-embedding-3-small", "dimensions": 1536, "normalized": true },
    "records": [{ "chunkId": "chunk:loginform:component", "relativePath": "src/LoginForm.tsx", "profileId": "text-embedding", "vector": [0.012, -0.044, 0.031] }],
    "warnings": [],
    "statistics": { "requestedChunks": 2, "embeddedChunks": 2, "providerCalls": 1, "truncatedInputs": 0 }
  },
  "synchronization": {
    "status": "complete",
    "warnings": [],
    "statistics": { "upsertedVectors": 2, "deletedVectors": 0 }
  }
}
```
