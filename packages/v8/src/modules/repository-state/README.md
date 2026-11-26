# Repository State

The index registry: it publishes immutable "snapshots" of the workspace index and tells everyone which one to trust.

## Does
- Publishes candidate descriptors (including output from `WorkspaceIndexingPipeline`) and derives readiness plus a deterministic `stateToken`.
- Reads state by `RepositoryStateReference`, tracks the latest per workspace, and pins / unpins state for active runs.
- Owns workspace scan, source analysis, chunking, code / text / vector indexes, and repo graph / map helpers used to build candidates.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `PublishRepositoryStateInput` (or an indexing result), or `Read` / `Pin` / `Unpin` inputs.
**Output:** publish / read / pin / unpin results carrying an optional `RepositoryStateDescriptor`.
**Pipeline:** `RepositoryStatePipeline` publish stages: `1-parse-candidate` → `2-build-descriptor` → `3-persist-descriptor` → `4-finalize-publish`. Indexing runs in the nested `WorkspaceIndexingPipeline`.
**Ports we offer / need:** needs `RepositoryStateStorePort` (publisher, reader, and active-run retention) and a `TreeSitterRuntimePort` for source analysis; optional clock and `ModuleLoggerPort`. Adapters fulfill them (`InMemoryRepositoryStateStore`, workspace index/retrieval runtime factories).

## Dependencies
**Upstream (this module uses):** none.
**Downstream (who uses this):** change-impact, code-navigation, decision-policy, planning, repository-context, request-understanding, skills, verification, and the engine (state pinning, tool input).

## How to use
```ts
import { RepositoryStatePipeline, InMemoryRepositoryStateStore } from "@mitii/v8/modules/repository-state";

const pipeline = new RepositoryStatePipeline({ store: new InMemoryRepositoryStateStore() });
const published = await pipeline.publish(candidate);
```

## Example
Input (illustrative, abbreviated):
```json
{ "workspaceId": "ws-1", "roots": [{ "id": "root-1", "path": "/repo" }], "generatedAt": "2026-11-25T12:00:00Z" }
```
Output (illustrative, abbreviated):
```json
{ "status": "published", "descriptor": { "stateToken": "st_…", "readiness": "ready" } }
```

## Non-responsibilities
Does not rank retrieval, build prompts, call models, run tools, or run verification commands.
