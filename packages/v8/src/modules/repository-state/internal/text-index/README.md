# Text Index

Text Index stores searchable chunk text and serves full-text search queries. It powers exact-path, phrase, identifier, and keyword retrieval for Repository Context.

## What This Module Does

- Maps chunking results into text-index documents.
- Plans updates by comparing document state.
- Writes changed chunk documents.
- Removes stale documents.
- Normalizes text search queries.
- Executes full-text search through a read port.
- Returns matches with snippets, scores, paths, and line ranges.

## Structure

```text
text-index/
  TextIndexCoordinator.ts
  TextIndexDocumentMapper.ts
  TextIndexUpdatePlanner.ts
  TextIndexUpdater.ts
  TextSearchService.ts
  TextQueryNormalizer.ts
  adapters/sqlite/
    SqliteTextIndexFactory.ts
    SqliteTextIndexReader.ts
    SqliteTextIndexWriter.ts
    SqliteFts5QueryBuilder.ts
    SqliteTextIndexMigration.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `TextIndexCoordinatorInput`: workspace, snapshot id, indexed time, optional pipeline version, and chunking result.
- `TextIndexDocument`: searchable chunk document.
- `TextSearchInput`: workspace, query, mode, prefix flag, limits, filters, kinds, and abort signal.
- `TextSearchResult`: status, matches, warnings, truncation, and statistics.
- `TextIndexReadPort`: search and read/query operations.
- `TextIndexWritePort`: document write/remove operations.
- `SqliteTextIndexModule`: reader, writer, coordinator, updater, and search service bundle.

## Technical Details

- SQLite FTS5 provides the default full-text implementation.
- Identifier expansion improves camelCase, snake_case, and symbol-name matching.
- `TextQueryNormalizer` supports any/all/phrase-style search.
- `TextIndexUpdatePlanner` avoids rewriting unchanged chunks.
- Search can filter by roots, folder prefix, file paths, and chunk kinds.
- Text-index schema version is part of repository index format compatibility.

## Ownership Boundaries

Owns chunk text indexing and full-text search.

Does not own chunk creation, vector embeddings, retrieval fusion, selection, or prompt assembly.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-state/internal/text-index
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

TextIndexCoordinatorInput -> TextIndexCoordinatorResult and TextSearchInput -> TextSearchResult:

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

Text Index result returns a result like this:

```json
{
  "index": {
    "schemaVersion": 1,
    "status": "updated",
    "chunkingStatus": "complete",
    "update": { "revision": "text-1", "documentsWritten": 2, "documentsRemoved": 0 }
  },
  "search": {
    "status": "complete",
    "matches": [
      { "chunkId": "chunk:loginform:component", "relativePath": "src/LoginForm.tsx", "score": 0.93, "snippet": "Sign in button is disabled while isSubmitting..." }
    ],
    "warnings": []
  }
}
```
