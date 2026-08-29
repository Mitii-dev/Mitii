# Workspace Indexing Pipeline

Workspace Indexing scans selected workspace files and produces the artifact revisions that Repository State can publish. It is the candidate producer for snapshots, source facts, chunks, code/text indexes, cleanup, and optional embeddings.

## What This Pipeline Does

- Normalizes indexing input.
- Selects files from a workspace snapshot.
- Reads source content.
- Runs source analysis.
- Hashes content.
- Chunks source text.
- Updates code and text indexes.
- Cleans stale index rows when allowed.
- Optionally synchronizes embeddings.
- Reports per-file results and warnings.

## Structure

```text
ws-indexing-pipeline/
  WorkspaceIndexingPipeline.ts
  WorkspaceIndexingFileSelector.ts
  WorkspaceIndexingFileProcessor.ts
  WorkspaceIndexingRequestNormalizer.ts
  WorkspaceIndexingRootFinalizer.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `WorkspaceIndexingPipelineInput`: workspace id, snapshot, indexed time, filters, limits, concurrency, versions, chunking options, failure mode, cleanup flag, embedding flag, and abort signal.
- `WorkspaceIndexingPipelineResult`: overall status, snapshot/root info, per-file results, artifact revisions, warnings, and statistics.
- `WorkspaceIndexingFileResult`: per-file status and stage-level outcomes for analysis, chunking, code index, text index, hash, warnings, and emitted chunks.
- `WorkspaceIndexingFilePolicyPort`: include/skip decision for each file.
- `WorkspaceIndexingAdapterComponents`: host-provided source reader, analyzer, chunking, indexes, embedding, and filesystem pieces.

## Technical Details

- Stages are selection, read, analysis, content hash, chunking, code index, text index, cleanup, and embedding.
- `failureMode` can be best-effort or fail-fast.
- `cleanupMissing` removes rows for files no longer retained.
- `synchronizeEmbeddings` is optional because vector generation may be slower or remote.
- The pipeline keeps time supplied by the caller for deterministic tests.

## Ownership Boundaries

Owns indexing orchestration and candidate artifact production.

Does not own immutable state publication, repository-context retrieval, model calls, or tool execution.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-state/pipeline/ws-indexing-pipeline
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

WorkspaceIndexingPipelineInput -> WorkspaceIndexingPipelineResult:

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

Workspace Indexing result returns a result like this:

```json
{
  "schemaVersion": 1,
  "workspace": "workspace-1",
  "status": "complete",
  "snapshotId": "snapshot-2026-08-14T12-00-00Z",
  "files": [
    {
      "rootId": "root",
      "relativePath": "src/LoginForm.tsx",
      "status": "complete",
      "analysisStatus": "complete",
      "chunkingStatus": "complete",
      "emittedChunks": 4,
      "codeIndexStatus": "updated",
      "textIndexStatus": "updated",
      "codeIndexChanged": true,
      "textIndexChanged": true,
      "warnings": []
    }
  ],
  "warnings": [],
  "statistics": { "selectedFiles": 1, "processedFiles": 1, "failedFiles": 0 }
}
```
