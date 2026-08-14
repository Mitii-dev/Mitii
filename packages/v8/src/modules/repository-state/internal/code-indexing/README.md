# Code Indexing

Code Indexing persists source-analysis facts into a code index. It stores file state, symbols, imports, references, and revisions so navigation, repo graph, repo map, and change impact can reason about code structure.

## What This Module Does

- Reads source content for a selected file.
- Runs source analysis or consumes prepared analysis.
- Hashes source content.
- Maps symbols/imports/references into index documents.
- Plans updates by comparing file state.
- Writes changed code-index rows.
- Removes stale rows for missing files.
- Reports changed/unchanged/failed status.

## Structure

```text
code-indexing/
  CodeIndexCoordinator.ts
  CodeIndexPreparedFileIndexer.ts
  CodeIndexDocumentMapper.ts
  CodeIndexImportResolver.ts
  InRepoLanguageImportResolver.ts
  CodeIndexUpdatePlanner.ts
  CodeIndexUpdater.ts
  adapters/sqlite/
    SqliteCodeIndexWriter.ts
    SqliteCodeIndexMigration.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `CodeIndexCoordinatorInput`: workspace, snapshot, file entry, optional source id/language/version/reference candidates, indexed time, and abort signal.
- `CodeIndexPreparedFileInput`: workspace, snapshot, file, analysis, content hash, indexed time, and write context.
- `CodeIndexDocument`: mapped file document with symbols, imports, references, and version data.
- `CodeIndexWritePort`: persistence contract for file state and code facts.
- `CodeIndexCoordinatorResult`: status and changed flag.
- `SqliteCodeIndexWriter`: SQLite implementation of the write/read contract.

## Technical Details

- `CodeIndexCoordinator.processFile` owns the read/analyze/hash/index flow.
- `CodeIndexPreparedFileIndexer.index` indexes already prepared analysis.
- `CodeIndexUpdatePlanner` skips unchanged files.
- `CodeIndexImportResolver` resolves in-repo imports where possible.
- SQLite migrations maintain index schema compatibility.
- Cleanup uses retained paths to remove stale rows.

## Ownership Boundaries

Owns code-structure indexing and stale code-index cleanup.

Does not own source parsing itself, repository-state publication, graph ranking, context retrieval, or tool execution.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-state/internal/code-indexing
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

CodeIndexCoordinatorInput -> CodeIndexCoordinatorResult:

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

Code Indexing result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "updated",
  "changed": true,
  "file": { "rootId": "root", "relativePath": "src/LoginForm.tsx" },
  "contentHash": "sha256-loginform",
  "write": {
    "revision": "code-1",
    "filesWritten": 1,
    "symbolsWritten": 1,
    "importsWritten": 3,
    "referencesWritten": 8
  },
  "warnings": []
}
```
