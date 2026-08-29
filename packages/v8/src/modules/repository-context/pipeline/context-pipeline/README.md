# Context Pipeline

Context Pipeline is the concrete orchestrator behind `RepositoryContextPipeline`. It resolves a published repository state and runs the three context stages: retrieval, selection, and assembly.

## What This Pipeline Does

- Validates public repository-context input.
- Resolves a `RepositoryStateReference`.
- Handles unknown or unavailable state as structured failures.
- Calls the configured retriever, selector, and assembler.
- Aggregates stage warnings and statistics.
- Produces a schema-validated `RepositoryContextPipelineResult`.

## Structure

```text
context-pipeline/
  RepositoryContextPipeline.ts
  constants.ts
  README.md
  tests/
```

## Types And Contracts

- `RepositoryContextPipelineInput`: state reference, query, mode, optional filters, breadth, references, selection budget, and abort signal.
- `RepositoryContextPipelineDependencies`: `stateResolver`, `retriever`, `selector`, and `assembler`.
- `RepositoryContextResolvedState`: descriptor, workspace snapshot, optional repo map, optional repo graph.
- `RepositoryContextPipelineResult`: state/snapshot ids, status, retrieval output, selection output, assembly output, warnings, and statistics.
- `RepositoryContextPipelineWarning`: stage-scoped warning with code and message.

## Technical Details

- The public method is `execute`.
- State resolution happens before any retrieval.
- Resolved artifacts are passed stage-to-stage; callers cannot mix arbitrary artifact revisions.
- Abort signals are passed through to long-running stages.
- Stage names are `state_resolution`, `retrieval`, `selection`, and `assembly`.

## Ownership Boundaries

Owns orchestration and result normalization.

Does not own retrieval scoring, selection ranking, content loading, state publication, or prompt construction.

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

Context Pipeline result returns a result like this:

```json
{
  "status": "complete",
  "stateToken": "state-abc",
  "workspaceSnapshotId": "snapshot-1",
  "retrieval": { "status": "complete", "statistics": { "returnedCandidates": 6 } },
  "selection": { "status": "complete", "statistics": { "selectedItems": 2, "droppedItems": 4 } },
  "assembly": { "status": "complete", "statistics": { "blocks": 2 } },
  "warnings": [],
  "statistics": { "retrievedCandidates": 6, "selectedItems": 2, "assembledBlocks": 2, "droppedBlocks": 0, "usedTokens": 1880 }
}
```
