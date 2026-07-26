# Code Indexing

`code-indexing` converts validated `SourceAnalysis` facts into an
incrementally maintained SQLite Code Index.

## What this module owns

- mapping `SourceAnalysis` into a persistence document;
- resolving relative imports against a `WorkspaceSnapshot`;
- deterministic change planning;
- atomic replacement of one file's symbols, imports, and references;
- metadata-only refreshes;
- deleted-file cleanup;
- monotonic per-root revisions;
- SQLite schema migration for legacy V7 tables.

## What this module does not own

- workspace walking;
- source parsing;
- chunking;
- FTS;
- embeddings or LanceDB;
- worker queues and concurrency;
- logging, telemetry, progress, retries, or UI state.

Those are engine/runtime concerns or separate V8 libraries.

## Flow

1. `CodeIndexCoordinator` reads and analyzes one workspace file.
2. `CodeIndexDocumentMapper` validates identity and resolves imports.
3. `CodeIndexUpdatePlanner` compares desired and persisted state.
4. `CodeIndexUpdater` executes only the planned mutation.
5. `SqliteCodeIndexWriter` commits the file and all facts atomically.

## Legacy mapping

The old implementation spread this behavior across:

- `WorkspaceScanner.computeDiff`;
- `WorkspaceScanner.persistScan`;
- `IndexQueue.indexFile`;
- `IndexMaintenanceService.removeFile`.

It also mixed structured indexing with chunks, FTS, vector writes,
logging, progress, scheduling, and filesystem access. This module is
the isolated replacement for only the structured Code Index part.

## Initialization

Run `SqliteCodeIndexMigration.migrate(database)` before constructing
the writer. The migration preserves the old `files`, `symbols`,
`file_imports`, and `symbol_refs` tables and adds V8 metadata columns.

The database port deliberately has no dependency on `better-sqlite3`.
Wrap your existing SQLite/ThunderDb object behind
`SqliteCodeIndexDatabasePort`.

## Engine integration

The engine supplies:

- an explicit `indexedAt` timestamp;
- an `AbortSignal`;
- a workspace snapshot;
- source reader and analyzer ports;
- optional logger/telemetry around the coordinator call.

This keeps library results deterministic and straightforward to test.
