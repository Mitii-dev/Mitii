# Repository Context

Repository Context turns a pinned repository state and a user query into prompt-safe code/context blocks. It resolves state, retrieves candidates, selects a bounded set, and assembles sanitized content.

## What This Module Does

- Resolves `RepositoryStateReference` into snapshot and artifacts.
- Retrieves candidates from repository intelligence sources.
- Selects relevant, diverse items under budget.
- Loads content from selected items.
- Redacts secrets, sanitizes text, truncates content, and records provenance.
- Returns retrieval, selection, assembly, warnings, and statistics.

## Structure

```text
repository-context/
  pipeline/
    context-pipeline/       RepositoryContextPipeline
  contracts/                Public input/result/dependency types
  internal/
    hybrid-retrieval/       Multi-source retrieval and fusion
    context-selection/      Candidate scoring and budgeted selection
    context-assembly/       Content loading and prompt-safe blocks
  adapters/
  tests/
```

## Types And Contracts

- `RepositoryContextPipelineInput`: state reference, query, mode, filters, breadth, references, selection budget, and abort signal.
- `RepositoryContextPipelineResult`: schema version, state token, snapshot id, query, mode, status, retrieval result, selection result, assembly result, warnings, and statistics.
- `RepositoryContextStateResolverPort`: resolves state references into descriptor/snapshot/artifacts.
- `RepositoryContextRetrieverPort`: retrieval stage port.
- `RepositoryContextSelectorPort`: selection stage port.
- `RepositoryContextAssemblerPort`: assembly stage port.

## Technical Details

- Public callers provide only a state reference, never independent artifact revisions.
- Status can be `complete`, `partial`, `empty`, `cancelled`, or `failed`.
- Retrieval can use repo map, repo graph, text index, and vector index.
- When `folderPrefix` is set, hybrid retrieval backfills repo-map files in that folder so a weak query cannot collapse the package catalog below `MINIMUM_FOLDER_SCOPED_RESULTS` (12) in-folder candidates.
- `context_ready.retrievalSources` (via the engine) surfaces per-source `sourceId` / `status` / `candidateCount` from hybrid `sourceReports`.
- Selection balances score, references, diversity, and budgets.
- Assembly applies content-source loading, secret redaction, sanitization, and truncation.

## Ownership Boundaries

Owns repository-context orchestration and context-stage contracts.

Does not own repository indexing, immutable state publication, prompt section allocation, model calls, or tool execution.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-context
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

RepositoryContextPipelineInput -> RepositoryContextPipelineResult:

```json
{
  "state": { "workspaceId": "workspace-1", "stateToken": "state-abc" },
  "query": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "mode": "agent",
  "filePaths": ["src/LoginForm.tsx"],
  "breadth": "focused",
  "selectionBudget": { "maximumTokens": 6000, "maximumItems": 8 }
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

Repository Context result returns a result like this:

```json
{
  "schemaVersion": 1,
  "stateToken": "state-abc",
  "workspaceSnapshotId": "snapshot-1",
  "query": "Add a loading state to the login button in src/LoginForm.tsx.",
  "mode": "agent",
  "status": "complete",
  "retrieval": { "status": "complete", "candidates": [{ "key": "file:src/LoginForm.tsx", "score": 0.98 }] },
  "selection": { "status": "complete", "items": [{ "selectionKey": "file:src/LoginForm.tsx", "relativePath": "src/LoginForm.tsx" }] },
  "assembly": { "status": "complete", "blocks": [{ "id": "repo:src/LoginForm.tsx", "relativePath": "src/LoginForm.tsx", "truncated": false }] },
  "warnings": [],
  "statistics": { "retrievedCandidates": 6, "selectedItems": 2, "assembledBlocks": 2, "droppedBlocks": 0, "usedTokens": 1880 }
}
```
