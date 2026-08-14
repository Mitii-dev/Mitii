# Hybrid Retrieval

Hybrid Retrieval gathers candidate context from repository intelligence sources and fuses them into one ranked candidate list. It is the first internal stage of Repository Context after state resolution.

## What This Module Does

- Normalizes retrieval requests.
- Executes registered retrieval sources.
- Captures per-source success, failure, skip, and warning reports.
- Deduplicates candidates across sources.
- Combines rankings with weighted reciprocal-rank fusion.
- Optionally reranks candidates using identifier-aware signals.
- Returns fused candidates and retrieval statistics.

## Structure

```text
hybrid-retrieval/
  HybridRetriever.ts
  HybridRetrievalFactory.ts
  RetrievalSourceRegistry.ts
  WeightedReciprocalRankFusion.ts
  IdentifierAwareRetrievalReranker.ts
  sources/
    RepoMapRetrievalSource.ts
    RepoGraphRetrievalSource.ts
    TextIndexRetrievalSource.ts
    VectorIndexRetrievalSource.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `HybridRetrievalInput`: workspace, query, filters, anchors, consistency guards, optional repo map/graph, and abort signal.
- `RetrievalSource`: source interface for repo map, graph, text, vector, or future sources.
- `RetrievalCandidate`: raw candidate emitted by one source.
- `HybridRetrievalCandidate`: fused candidate with contributions and final score.
- `HybridRetrievalResult`: status, query, candidates, source reports, warnings, truncation, and statistics.
- `HybridRetrievalFactoryDependencies`: dependencies needed to build a retriever from repository-state read ports.

## Technical Details

- File filters scope retrieval; anchor files seed graph expansion but are not scope filters.
- Candidate keys prevent duplicate path/span/symbol results.
- Source weights let exact text, graph, map, and vector evidence contribute differently.
- Identifier-aware reranking boosts matches such as `LoginForm`, `login`, and `button`.
- Partial source failures can still produce a usable `partial` result.

## Ownership Boundaries

Owns candidate discovery and fusion.

Does not own final context selection, file content loading, secret redaction, or prompt budgeting.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-context/internal/hybrid-retrieval
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

HybridRetrievalInput -> HybridRetrievalResult:

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

Hybrid Retrieval result returns a result like this:

```json
{
  "schemaVersion": 1,
  "query": "Add a loading state to the login button in src/LoginForm.tsx.",
  "status": "complete",
  "candidates": [
    { "key": "path:src/LoginForm.tsx", "relativePath": "src/LoginForm.tsx", "score": 0.98, "sources": ["repo_map", "text_index"] },
    { "key": "path:src/LoginForm.test.tsx", "relativePath": "src/LoginForm.test.tsx", "score": 0.74, "sources": ["repo_graph", "text_index"] }
  ],
  "sourceReports": [
    { "sourceId": "repo_map", "status": "complete", "candidates": 1 },
    { "sourceId": "text_index", "status": "complete", "candidates": 4 }
  ],
  "warnings": [],
  "truncated": false,
  "statistics": { "attemptedSources": 4, "successfulSources": 4, "uniqueCandidates": 6, "returnedCandidates": 6 }
}
```
