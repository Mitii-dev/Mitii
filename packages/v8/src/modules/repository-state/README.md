# Repository State

Publishes one authoritative, immutable description of a workspace so every
consumer pins the same snapshot, catalog, index, graph, map, and vector
revisions.

## Input → output

| Operation | Input | Output |
|---|---|---|
| `publish` | Candidate root revision manifests + scan completeness | `RepositoryStateReference` + `RepositoryStateDescriptor` |
| `publishFromIndexing` | `WorkspaceIndexingPipelineResult` | Same as `publish` after candidate mapping |
| `read` | `RepositoryStateReference` | Descriptor or unknown/mismatch |
| `pin` / `unpin` | Reference + `runId` | Retention for active runs |
| `getLatest` | `workspaceId` | Newest descriptor for new runs |

## Stages

1. Validate candidate contract (or map from indexing)
2. Derive readiness and `cleanupAllowed` from scan completeness + capabilities
3. Derive deterministic `stateToken` from the canonical manifest
4. Atomically publish an immutable descriptor
5. Pin/unpin for active-run retention

## Dependencies

- `RepositoryStateStorePort` (publisher + reader + retention)
- Optional clock for `generatedAt`

Does **not** own prompting, retrieval, tool execution, or model calls.

## Public exports

- `RepositoryStatePipeline` (includes `publishFromIndexing`)
- `InMemoryRepositoryStateStore` and other public adapters
- State reference/descriptor schemas and types
- Cross-module artifact contracts (snapshot/graph/map/ports)
- Language profile registry
- `WorkspaceIndexingPipeline` (candidate producer; not the authority facade)

`buildPublishCandidateFromIndexing` remains an internal action used by
`publishFromIndexing`; it is not root-exported.

## Failure modes

- Invalid candidate → `invalid_candidate`
- Unknown token → `unknown_state_token`
- Mutating a published token → `state_immutable`
- Deleting a pinned token → `state_pinned`
- Abort during publish → `publication_cancelled`

Incomplete scans (`partial` / `filtered` / `truncated` / `cancelled`) publish as
`degraded` or `unavailable` with `cleanupAllowed: false`.
