# Chunking

Chunking splits source or text content into stable, searchable chunks. Chunks are the unit used by text search, vector embeddings, and repository context assembly.

## What This Module Does

- Validates file content and options.
- Chooses code, markdown, or text chunking strategy.
- Uses source-analysis symbol ranges when available.
- Splits content into bounded spans.
- Adds overlap where configured.
- Normalizes ranges, titles, hashes, token estimates, and chunk ids.
- Reports warnings, truncation, and statistics.

## Structure

```text
chunking/
  ChunkingService.ts
  ChunkingFactory.ts
  ChunkNormalizer.ts
  ChunkIdBuilder.ts
  ChunkSpanSplitter.ts
  ChunkTextIndex.ts
  strategies/
    CodeChunker.ts
    MarkdownChunker.ts
    TextChunker.ts
    ChunkingStrategyRegistry.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `ChunkingInput`: source id, root id, relative path, content, optional language/hash/source analysis, and abort signal.
- `ChunkingOptions`: max input, overflow policy, target/max/min chunk characters, overlap, boundary search, max chunks, and title length.
- `Chunk`: chunk id, root/path, kind, ordinal, content, title, line range, hash, token estimate, and optional symbol id.
- `ChunkingResult`: status, chunks, warnings, statistics, content hash, and truncation details.
- `ChunkingServicePort`: `chunk(input, options)` facade contract.

## Technical Details

- Code chunking can use symbol spans from Source Analysis.
- Markdown chunking follows headings where possible.
- Text chunking uses generic span splitting.
- `ChunkIdBuilder` makes stable ids from file and span facts.
- Token estimation is character-based by default.
- Overflow can truncate or reject based on options.

## Ownership Boundaries

Owns file-to-chunk conversion and chunk invariants.

Does not own file reads, source parsing, index writes, embedding generation, or retrieval fusion.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-state/internal/chunking
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

ChunkingInput -> ChunkingResult:

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

Chunking result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "complete",
  "sourceId": "root:src/LoginForm.tsx",
  "sourceContentHash": "sha256-loginform",
  "chunks": [
    { "id": "chunk:loginform:imports", "kind": "code_region", "relativePath": "src/LoginForm.tsx", "ordinal": 0, "startLine": 1, "endLine": 11, "tokenEstimate": 180, "title": "imports" },
    { "id": "chunk:loginform:component", "kind": "code_symbol", "relativePath": "src/LoginForm.tsx", "ordinal": 1, "startLine": 12, "endLine": 84, "tokenEstimate": 920, "title": "LoginForm" }
  ],
  "warnings": [],
  "statistics": { "inputCharacters": 4200, "emittedChunks": 2, "estimatedTokens": 1100 }
}
```
