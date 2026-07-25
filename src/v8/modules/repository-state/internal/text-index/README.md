# V8 Text Index

Text Index persists `ChunkingResult` output and provides bounded lexical
retrieval. SQLite FTS5 is an adapter detail; callers depend on
`TextIndexReadPort` and `TextIndexWritePort`.

## Responsibilities

- Map indexable Chunking output into a versioned Text Index document.
- Atomically replace a document and its chunks.
- Keep SQLite FTS rows synchronized through database triggers.
- Compile user text into safe normalized search terms.
- Return bounded, schema-validated search results.
- Track per-root revisions and chunk changes for the future embedding pipeline.
- Preserve the last valid document when Chunking is cancelled, rejected, or
  failed.

## File tree

```text
text-index/
├── adapters/
│   └── sqlite/
│       ├── SqliteFts5QueryBuilder.ts
│       ├── SqliteTextIndexFactory.ts
│       ├── SqliteTextIndexMigration.ts
│       ├── SqliteTextIndexReader.ts
│       └── SqliteTextIndexWriter.ts
├── tests/
│   └── TextIndex.spec.ts
├── TextIndexCoordinator.ts
├── TextIndexDocumentMapper.ts
├── TextIndexError.ts
├── TextIndexUpdatePlanner.ts
├── TextIndexUpdater.ts
├── TextQueryNormalizer.ts
├── TextSearchService.ts
├── constants.ts
├── index.ts
├── README.md
├── schema.ts
└── types.ts
```

The reusable SQLite contracts are located in:

```text
shared/sqlite/
├── index.ts
└── types.ts
```

## Assembly

```ts
import {
  SqliteTextIndexFactory,
  SqliteTextIndexMigration,
} from "./text-index";

await new SqliteTextIndexMigration()
  .migrate(database);

const textIndex =
  new SqliteTextIndexFactory()
    .create(database);

await textIndex.coordinator.index({
  workspace,
  workspaceSnapshotId,
  indexedAt,
  chunking: chunkingResult,
});

const result =
  await textIndex.search.search({
    workspace,
    query: "authentication middleware",
    rootIds: ["workspace"],
    maximumResults: 20,
  });
```

## Search behavior

- Raw FTS syntax is never accepted from the user.
- Queries are Unicode-tokenized, bounded, de-duplicated, and converted into
  quoted FTS5 terms.
- `any`, `all`, and `phrase` modes are supported.
- Workspace, root, folder, exact-file, and chunk-kind filters are applied
  before results leave SQLite.
- The reader fetches one extra row to report truncation accurately.
- BM25 is retained as `rawRank`; a deterministic result-set score is also
  returned between 0 and 1.

## Change feed

Every content-changing write increments a per-workspace-root revision.
`getChanges()` returns chunk `upsert` and `delete` events. The embedding and
LanceDB modules can consume this feed without rescanning every document.
Metadata-only snapshot refreshes do not change the revision.

## Deliberately outside this module

- File reading and chunk construction
- Embedding generation
- LanceDB or vector search
- Hybrid ranking
- Context budgeting
- Logging, telemetry, queues, retries, and scheduling

Those remain downstream adapter or engine responsibilities.
