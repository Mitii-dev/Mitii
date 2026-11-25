# Repository State

Publishes and reads immutable workspace index descriptors. Authority for state tokens used by repository context, verification, and active-run retention.

## Does

- Publish candidate descriptors (and from `WorkspaceIndexingPipeline` output).
- Derive readiness, cleanup allowance, and deterministic `stateToken`.
- Read by `RepositoryStateReference`; pin/unpin for active runs; track latest per workspace.
- Own workspace scan, source analysis, chunking, code/text/vector indexes, repo graph/map helpers used to build candidates.

## Contract

**In:** `PublishRepositoryStateInput` | indexing result | `Read`/`Pin`/`Unpin` inputs.

**Out:** publish/read/pin/unpin results with optional `RepositoryStateDescriptor`.

**Ports:** `RepositoryStateStorePort`, `TreeSitterRuntimePort`; optional `ModuleLoggerPort`.

**Stages (publish):** `1-parse-candidate` → `2-build-descriptor` → `3-persist-descriptor` → `4-finalize-publish`.

## Example

```ts
import {
  RepositoryStatePipeline,
  InMemoryRepositoryStateStore,
} from "@mitii/v8/modules/repository-state";

const store = new InMemoryRepositoryStateStore();
const pipeline = new RepositoryStatePipeline({ store });
const result = await pipeline.publish(candidate);
```

## Non-responsibilities

Does not own prompt construction, retrieval ranking, model calls, tool execution, or verification commands.
