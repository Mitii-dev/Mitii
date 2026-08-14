# Vector Index

Vector Index stores embedding vectors and serves semantic search over repository chunks. It complements Text Index when relevant code does not share exact query words.

## What This Module Does

- Normalizes vector search input.
- Guards embedding profile compatibility.
- Builds storage-safe table names.
- Executes vector search through LanceDB adapter ports.
- Applies root/path/kind filters.
- Returns ranked vector matches with chunk metadata and scores.

## Structure

```text
vector-index/
  VectorIndexFactory.ts
  VectorSearchService.ts
  VectorSearchRequestNormalizer.ts
  VectorIndexTableNameBuilder.ts
  KeyedAsyncLock.ts
  adapters/lancedb/
    LanceDbVectorIndexFactory.ts
    LanceDbVectorIndexReader.ts
    LanceDbVectorIndexWriter.ts
    LanceDbTableManager.ts
    LanceDbRowMapper.ts
    LanceDbFilterBuilder.ts
    LanceDbProfileGuard.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `VectorSearchInput`: workspace, embedding profile, query vector, filters, limits, and adapter-specific tuning.
- `VectorSearchResult`: status, matches, warnings, truncation, and statistics.
- `VectorSearchMatch`: chunk id, root/path, kind, line range, score, preview/title, and profile.
- `VectorIndexReadPort`: vector-search read contract.
- `VectorIndexModule`: reader plus vector-index services.
- `LanceDbVectorIndexComponents`: LanceDB connection/table/query/merge dependencies.

## Technical Details

- Profile guards prevent querying vectors with mismatched embedding spaces.
- Table names are derived from workspace/profile in a storage-safe way.
- LanceDB adapters manage table creation, filters, row mapping, and vector queries.
- `KeyedAsyncLock` serializes table work when required.
- Search supports `nprobes`, `refineFactor`, and candidate multiplier options.

## Ownership Boundaries

Owns vector search and vector-index adapter contracts.

Does not own embedding generation, text indexing, retrieval fusion, selection, or prompt assembly.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-state/internal/vector-index
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

VectorSearchInput -> VectorSearchResult:

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

Vector Index search result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "complete",
  "matches": [
    {
      "chunkId": "chunk:loginform:component",
      "rootId": "root",
      "relativePath": "src/LoginForm.tsx",
      "kind": "code_symbol",
      "startLine": 12,
      "endLine": 84,
      "score": 0.89,
      "title": "LoginForm",
      "preview": "Login form submit handler and button state"
    }
  ],
  "warnings": [],
  "truncated": false,
  "statistics": { "returnedMatches": 1, "searchedRows": 42 }
}
```
