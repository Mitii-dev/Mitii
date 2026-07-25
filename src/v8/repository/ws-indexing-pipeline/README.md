# Workspace Indexing Pipeline

```text
Input:
  WorkspaceSnapshot + deterministic indexedAt + optional scope and limits

Output:
  WorkspaceIndexingPipelineResult
```

The pipeline orchestrates already-isolated repository capabilities:

```text
Workspace files
      ↓
Read once
      ↓
Source Analysis ─────────────→ Code Index
      ↓                           ↑
Content hash → Chunking ─────→ Text Index
                                  ↓
                       Embedding Synchronizer
                                  ↓
                             Vector Index
```

## Safety rules

- Source content is read once per file.
- Source analysis and hashing share the same content.
- Code and text indexes receive the same content hash.
- Missing-file cleanup runs only for a complete, unfiltered,
  non-truncated snapshot run.
- A file-policy failure excludes that file and disables cleanup for the run.
- A failed or partial snapshot can never delete unseen indexed files.
- Embeddings synchronize from the Text Index change feed after file writes.
- `indexedAt` comes from the Engine clock; this module does not read time.
- Per-file output is bounded while aggregate statistics remain complete.
- Expected file failures are visible in the result instead of being hidden.

The module does not build prompts, call an LLM, execute tools, select models,
manage sessions, emit telemetry, or own retry policy.
