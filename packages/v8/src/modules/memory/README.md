# Memory

Memory retrieves and commits durable facts scoped to a user, workspace, or project. It supplies relevant prior preferences to Prompt Construction as instruction blocks.

## What This Module Does

- Retrieves candidate memory facts from an injected store.
- Filters by scope, privacy, expiry, and requester.
- Scores relevance against the current query.
- Applies a token budget and max-fact limit.
- Returns prompt-ready memory instruction blocks.
- Commits new facts with scope, tags, privacy, source, and optional expiry.

## Structure

```text
memory/
  pipeline/                 MemoryPipeline
  actions/                  Filtering, scoring, budgeting, commit preparation
  adapters/                 InMemoryMemoryStore
  contracts/
    input/                  MemoryRetrieveInput, MemoryCommitInput
    output/                 MemoryFact, MemoryRetrieveResult, MemoryCommitResult
    ports/                  MemoryStorePort, MemoryIdGeneratorPort
    errors/                 MemoryErrors
  tests/
```

## Types And Contracts

- `MemoryRetrieveInput`: query, scope, requester user id, budget, max facts, and optional time.
- `MemoryCommitInput`: content, scope, tags, privacy, source, expiry, and optional time.
- `MemoryScope`: user, workspace, or project with required matching id.
- `MemoryFact`: stored content with metadata.
- `MemoryRetrieveResult`: instruction blocks, omissions, token usage, warnings, reason codes, and duration.
- `MemoryCommitResult`: commit status, optional memory id, expiry, warnings, reason codes, and duration.

## Technical Details

- The public methods are `retrieve` and `commit`.
- Privacy levels are `private` and `shareable`.
- Expired facts are filtered out during retrieval.
- `InMemoryMemoryStore` supports tests and simple hosts.
- Memory retrieval returns instruction blocks, not raw store rows.

## Ownership Boundaries

Owns memory fact contracts, retrieval, privacy filtering, expiry, scoring, budgeting, and commit preparation.

Does not own automatic memory policy, prompt section allocation, repository retrieval, or tool grants.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/memory
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

MemoryRetrieveInput -> MemoryRetrieveResult:

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

Memory retrieval result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "retrieved",
  "instructions": [
    {
      "id": "mem-42",
      "title": "Workspace UI preference",
      "content": "Use the shared Button component for form actions when one already exists.",
      "priority": 90,
      "provenance": { "memoryId": "mem-42", "source": "memory", "scopeKind": "workspace", "score": 0.84, "privacy": "shareable", "createdAt": "2026-08-01T10:00:00.000Z" }
    }
  ],
  "omissions": [],
  "usedTokens": 38,
  "budgetTokens": 600,
  "warnings": [],
  "reasonCodes": ["memory_retrieved"],
  "durationMs": 5
}
```
