# V8 Chunking

This module converts one already-read source file into deterministic,
bounded chunks. It does not read files, parse source code, write indexes,
generate embeddings, emit telemetry, or manage queues.

## Responsibilities

- Select one registered chunking strategy.
- Prefer source-analysis symbol ranges for code.
- Preserve Markdown heading sections.
- Fall back to bounded text chunks for every other file.
- Apply explicit character, overlap, input, and chunk-count limits.
- Calculate deterministic content hashes and chunk IDs.
- Estimate tokens through an injected port.
- Validate the complete output with Zod.

## File tree

```text
chunking/
├── adapters/
│   └── node/
│       └── NodeSha256ChunkHasher.ts
├── strategies/
│   ├── ChunkingStrategyRegistry.ts
│   ├── CodeChunker.ts
│   ├── MarkdownChunker.ts
│   └── TextChunker.ts
├── tests/
│   └── ChunkingService.spec.ts
├── CharacterTokenEstimator.ts
├── ChunkIdBuilder.ts
├── ChunkNormalizer.ts
├── ChunkSpanSplitter.ts
├── ChunkTextIndex.ts
├── ChunkingFactory.ts
├── ChunkingService.ts
├── constants.ts
├── index.ts
├── schema.ts
└── types.ts
```

## Assembly

```ts
import {
  ChunkingFactory,
  NodeSha256ChunkHasher,
} from "./chunking";

const chunker =
  new ChunkingFactory().create({
    hasher:
      new NodeSha256ChunkHasher(),
  });

const result =
  await chunker.chunk({
    sourceId: "source:src/auth.ts",
    rootId: "workspace",
    relativePath: "src/auth.ts",
    language: "typescript",
    content,
    sourceAnalysis,
  });
```

## Important contracts

- `content` is already decoded text. File reading belongs to
  `source-analysis/SourceFileReader` or an engine-owned reader.
- `sourceAnalysis` is optional. `CodeChunker` uses it only when its source
  identity matches the chunking input.
- `startOffset` is inclusive and `endOffset` is exclusive.
- Line numbers are one-based and inclusive.
- Chunk IDs are stable for the same source hash, boundaries, strategy,
  and chunk content.
- A truncated input returns `partial`; a rejected oversized input returns
  `rejected`.
- The default token estimator is intentionally approximate. Inject a
  model-aware estimator at engine assembly time when exact budgeting is
  required.

## Deliberately outside this module

- SQLite chunk persistence
- FTS indexing
- Embedding generation
- LanceDB writes
- Runtime logging and telemetry
- Worker queues and concurrency
- Context selection and prompt budgeting

Those components consume `ChunkingResult` downstream.
