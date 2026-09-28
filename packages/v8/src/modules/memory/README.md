# Memory

Memory retrieves and commits durable facts scoped to a user, workspace, or project. Recalled facts are rendered by Prompt Construction as untrusted evidence, not system instructions.

## What This Module Does

- Retrieves candidate memory facts from an injected store.
- Filters by scope, privacy, expiry, requester identity, validation state, and superseded versions.
- Ranks with BM25 fused with file-target hits and an optional embedding port.
- Mixes access-based retention so cold facts lose rank without a hard 30-day delete.
- Applies a token budget and max-fact limit; may append a file-based workspace profile.
- Returns prompt-ready memory instruction blocks for evidence rendering.
- Commits structured facts after privacy redact, hash reinforce, and explicit `replacesId` correction.
- Exposes `MemoryContentPolicy` so hosts sanitize titles, bodies, and graph observations before persist.

## Structure

```text
memory/
  pipeline/                 MemoryPipeline
  actions/                  Filtering, BM25/file ranking, budgeting, commit preparation
  internal/                 Stemmer, synonyms, tokenizer, BM25 index, RRF fusion
  graph/                    KnowledgeGraphManager + schemas (entities/relations)
  observe/                  buildSyntheticMemoryDraft (host capture helper)
  adapters/                 InMemoryMemoryStore, HashMemoryEmbedding, graph re-exports
  contracts/
    input/                  MemoryRetrieveInput, MemoryCommitInput
    output/                 MemoryFact, MemoryRetrieveResult, MemoryCommitResult
    ports/                  MemoryStorePort, MemoryIdGeneratorPort, MemoryEmbeddingPort
    errors/                 MemoryErrors
  tests/
```

## Types And Contracts

- `MemoryRetrieveInput`: query, scope, requester user id, origin, budget, max facts, optional file targets/concepts, and optional time.
- `MemoryCommitInput`: content, scope, tags, type, concepts, files, importance, privacy, source, expiry, optional `replacesId`, and optional time.
- `MemoryScope`: user, workspace, or project with required matching id.
- `MemoryFact`: structured stored content (type, concepts, files, version, provenance) with metadata.
- `MemoryRetrieveResult`: instruction blocks, omissions, token usage, warnings, reason codes, and duration.
- `MemoryCommitResult`: commit status, optional memory id, expiry, warnings, reason codes, and duration.

## Technical Details

- The public methods are `retrieve`, `commit`, and `consolidate`.
- Privacy levels are `private` and `shareable`. Private facts require both a stored owner and `requesterUserId`; missing identity denies recall.
- Fact types are `pattern`, `preference`, `architecture`, `bug`, `workflow`, and `fact`.
- Expired, `needs_revalidation`, and superseded (`isLatest: false`) facts are filtered out during retrieval.
- Retrieve ranks with BM25 + file-target + optional vector RRF fusion; final selection can diversify by source.
- Commits redact secrets, reject 5-minute exact duplicates, reinforce matching hashes when privacy/applicability agree, and supersede only when `replacesId` names an eligible latest fact. Atomic stores implement `transact`.
- `InMemoryMemoryStore` supports tests and simple hosts. Hosts own observation files, eviction, and audit logs.
- Optional `MemoryEmbeddingPort` stays host-injected. No model runtime lives in this module.
- **Host durability:** `FileWorkspaceMemoryStore` / VS Code Memento adapters serialize RMW, validate envelopes before mutation, refuse corrupt/partial writes that would discard rows, and return honest `{ deleted, message }` delete results. File adapters also use exclusive locks and `transact`.
- **Host leases:** `FileWorkspaceMemoryLeaseStore` (`.mitii/memory/leases.json`) gates `memory:consolidate` and `memory:approve_pending` with TTL acquire/release/renew. `approvePendingMemory` and `runMemoryConsolidateWithLease` use these leases.
- **Knowledge graph (beside facts):** optional `KnowledgeGraphPort` / `KnowledgeGraphManager` stores entities, relations, and observations (JSONL on disk via host). Observations are sanitized through `MemoryContentPolicy`. Tools: `memory_graph_search`, `memory_graph_open`, `memory_graph_update`. Does not replace BM25 fact retrieve — use graph for who/owns/depends; facts for prefs/patterns.

## Ownership Boundaries

Owns memory fact contracts, retrieval, privacy redaction, expiry, scoring, budgeting, and commit preparation.

Does not own automatic memory policy, prompt section allocation, repository retrieval, or tool grants. CLI and VS Code pass `memoryEmbedding` into the engine and call `observeRunToolEvent` after mutating or failed tools.

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
