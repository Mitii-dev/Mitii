# Repository State

Repository State publishes and reads immutable descriptions of a workspace's indexed state. It is the authority for state tokens used by repository context, verification, and active-run retention.

## What This Module Does

- Publishes candidate repository descriptors.
- Converts workspace-indexing output into publish candidates.
- Derives readiness, cleanup allowance, and deterministic state tokens.
- Reads descriptors by `RepositoryStateReference`.
- Pins and unpins state for active runs.
- Tracks latest descriptor for a workspace.

## Structure

```text
repository-state/
  pipeline/                 RepositoryStatePipeline
    ws-indexing-pipeline/   Workspace indexing candidate producer
  contracts/
    input/                  Publish/read/pin/unpin inputs
    output/                 RepositoryStateReference, descriptor, results
    ports/                  RepositoryStateStorePort, TreeSitterRuntimePort
    artifacts/              Snapshot, graph, map, index artifacts
    language/               Language profiles
  internal/                 Workspace scan, source analysis, chunking, indexes
  adapters/                 In-memory store, filesystem/index runtime helpers
  tests/
```

## Types And Contracts

- `RepositoryStateReference`: `{ workspaceId, stateToken }`.
- `RepositoryStateDescriptor`: snapshot id, roots, readiness, reasons, generated time, scan completeness, and cleanup permission.
- `RepositoryRootState`: project catalog, code/text/vector/graph/map revisions and capabilities for a root.
- `PublishRepositoryStateInput`: workspace id, snapshot id, roots, scan completeness, reasons, and optional generated time.
- `PublishRepositoryStateResult`: published, failed, or cancelled outcome.
- `RepositoryStateStorePort`: persistence contract for publish/read/pin/unpin/latest.

## Technical Details

- Published descriptors are immutable.
- Active runs pin states so cleanup does not remove required artifacts.
- Readiness can be `ready`, `degraded`, or `unavailable`.
- Partial/filtered/truncated/cancelled scans publish as degraded or unavailable.
- `REPOSITORY_INDEX_FORMAT` changes require hosts to rebuild persisted indexes.
- Workspace Indexing produces candidates; Repository State is the publication authority.

## Ownership Boundaries

Owns state references, descriptors, publication, retention, readiness, and artifact revision contracts.

Does not own prompt construction, retrieval ranking, model calls, tool execution, or verification commands.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-state
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

WorkspaceIndexingPipelineResult -> PublishRepositoryStateResult:

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

Repository State publication result returns a result like this:

```json
{
  "status": "published",
  "reference": { "workspaceId": "workspace-1", "stateToken": "state-abc" },
  "descriptor": {
    "schemaVersion": 1,
    "workspaceId": "workspace-1",
    "stateToken": "state-abc",
    "snapshotId": "snapshot-2026-08-14T12-00-00Z",
    "readiness": "ready",
    "scanCompleteness": "complete",
    "cleanupAllowed": true,
    "roots": [{ "rootId": "root", "projectCatalogRevision": "catalog-1", "codeIndexRevision": "code-1", "textIndexRevision": "text-1", "graphRevision": "graph-1", "mapRevision": "map-1", "capabilities": [{ "capability": "text_index", "status": "ready" }] }],
    "reasons": [],
    "generatedAt": "2026-08-14T12:00:00.000Z"
  }
}
```
