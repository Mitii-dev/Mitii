# V8 Repository Intelligence Replacement

This bundle contains aligned replacements for:

- `chunking`
- `code-index`
- `code-indexing`
- `repo-graph`
- `repo-map`
- `source-analysis`
- `text-index`

## Complete file tree

```text
v8-repository-intelligence/
├── chunking/
│   ├── adapters/
│   │   └── node/
│   │       └── NodeSha256ChunkHasher.ts
│   ├── strategies/
│   │   ├── ChunkingStrategyRegistry.ts
│   │   ├── CodeChunker.ts
│   │   ├── MarkdownChunker.ts
│   │   └── TextChunker.ts
│   ├── tests/
│   │   └── ChunkingService.spec.ts
│   ├── CharacterTokenEstimator.ts
│   ├── ChunkIdBuilder.ts
│   ├── ChunkNormalizer.ts
│   ├── ChunkSpanSplitter.ts
│   ├── ChunkTextIndex.ts
│   ├── ChunkingFactory.ts
│   ├── ChunkingService.ts
│   ├── constants.ts
│   ├── index.ts
│   ├── README.md
│   ├── schema.ts
│   └── types.ts
├── code-index/
│   ├── adapters/
│   │   └── sqlite/
│   │       └── SqliteCodeIndexAdapter.ts
│   ├── CodeIndexError.ts
│   ├── CodeIndexIdBuilder.ts
│   ├── constants.ts
│   ├── index.ts
│   ├── schema.ts
│   └── types.ts
├── code-indexing/
│   ├── adapters/
│   │   ├── node/
│   │   │   └── NodeSha256ContentHasher.ts
│   │   └── sqlite/
│   │       ├── SqliteCodeIndexMigration.ts
│   │       └── SqliteCodeIndexWriter.ts
│   ├── CodeIndexCoordinator.ts
│   ├── CodeIndexDocumentMapper.ts
│   ├── CodeIndexImportResolver.ts
│   ├── CodeIndexUpdatePlanner.ts
│   ├── CodeIndexUpdater.ts
│   ├── CodeIndexWriteError.ts
│   ├── constants.ts
│   ├── index.ts
│   ├── README.md
│   ├── schema.ts
│   └── types.ts
├── repo-graph/
│   ├── RepoGraphBuilder.ts
│   ├── RepoGraphEdgeAccumulator.ts
│   ├── constants.ts
│   ├── index.ts
│   ├── schema.ts
│   └── types.ts
├── repo-map/
│   ├── ranking/
│   │   ├── RepoMapRanker.ts
│   │   └── pageRank.ts
│   ├── RepoMapBudgetApplier.ts
│   ├── RepoMapBuilder.ts
│   ├── RepoMapRenderer.ts
│   ├── constants.ts
│   ├── index.ts
│   ├── schema.ts
│   └── types.ts
├── source-analysis/
│   ├── extractors/
│   │   └── GenericImportExtractor.ts
│   ├── parsers/
│   │   ├── RegexSourceParser.ts
│   │   ├── SourceParserRegistry.ts
│   │   ├── TreeSitterSourceParser.ts
│   │   └── TypeScriptSourceParser.ts
│   ├── LanguageDetector.ts
│   ├── SourceAnalysisBuilder.ts
│   ├── SourceAnalysisFactory.ts
│   ├── SourceAnalysisNormalizer.ts
│   ├── SourceFactIdBuilder.ts
│   ├── SourceFileReadError.ts
│   ├── SourceFileReader.ts
│   ├── constants.ts
│   ├── index.ts
│   ├── README.md
│   ├── schema.ts
│   └── types.ts
├── shared/
│   └── sqlite/
│       ├── index.ts
│       └── types.ts
├── text-index/
│   ├── adapters/
│   │   └── sqlite/
│   │       ├── SqliteFts5QueryBuilder.ts
│   │       ├── SqliteTextIndexFactory.ts
│   │       ├── SqliteTextIndexMigration.ts
│   │       ├── SqliteTextIndexReader.ts
│   │       └── SqliteTextIndexWriter.ts
│   ├── tests/
│   │   └── TextIndex.spec.ts
│   ├── TextIndexCoordinator.ts
│   ├── TextIndexDocumentMapper.ts
│   ├── TextIndexError.ts
│   ├── TextIndexUpdatePlanner.ts
│   ├── TextIndexUpdater.ts
│   ├── TextQueryNormalizer.ts
│   ├── TextSearchService.ts
│   ├── constants.ts
│   ├── index.ts
│   ├── README.md
│   ├── schema.ts
│   └── types.ts
└── README.md
```

The implementation follows these boundaries:

- Chunking converts already-read text and optional Source Analysis into
  deterministic, bounded chunks.
- Text Index atomically persists Chunking output and exposes bounded lexical
  retrieval.
- Code Index exposes factual files, symbols, imports, and references.
- Code Indexing incrementally persists Source Analysis facts in SQLite.
- Repo Graph converts Code Index facts into a bounded structural graph.
- Repo Map ranks a supplied Repo Graph and never re-queries SQLite.
- SQLite numeric IDs remain private to the adapter.
- Public file and symbol IDs are deterministic.
- Tunable values remain in each module's `constants.ts`.
- Source Analysis produces deterministic symbols, imports, and references.

## New files

Add these files in addition to replacing existing files:

- `code-index/CodeIndexIdBuilder.ts`
- `repo-graph/RepoGraphEdgeAccumulator.ts`
- `shared/sqlite/index.ts`
- `shared/sqlite/types.ts`
- the complete `text-index/` module

Because Code Indexing now reuses the shared SQLite contract, replace:

- `code-indexing/types.ts`
- `code-indexing/CodeIndexCoordinator.ts`
- `code-indexing/CodeIndexUpdater.ts`

If your current Repo Map does not already have the separated classes,
also add:

- `repo-map/RepoMapBudgetApplier.ts`
- `repo-map/RepoMapBuilder.ts`
- `repo-map/RepoMapRenderer.ts`
- `repo-map/ranking/RepoMapRanker.ts`
- `repo-map/ranking/pageRank.ts`

## Expected sibling modules

The bundle expects existing exports from:

- `../workspace`
  - `WorkspaceSnapshot`
  - `WorkspaceFileEntry`
- `../catalog`
  - `ProjectCatalog`
  - `ProjectDefinition`
  - `ProjectRelationship`

Adjust those two relative import paths if your folder names differ.

## Important behavior changes

1. `CodeIndexReadPort.getSymbols()` returns `CodeIndexSymbolQueryResult`.
2. Code Index imports retain `specifier` and `line`.
3. Code Index references expose `resolved`, `ambiguous`, or `unresolved`.
4. Repo Graph records evidence truncation explicitly.
5. Repo Graph enforces global file, symbol, node, and edge limits.
6. Repo Map consumes `RepoGraph` and does not consume `CodeIndexReadPort`.
7. Tree-sitter loading is injected through `TreeSitterRuntimePort`.
8. TypeScript and regex parsing work without Tree-sitter.
9. Code Indexing replaces a file's structured facts in one transaction.
10. Failed source analysis preserves the last valid indexed document.
11. Content hashes are computed from the exact text that was analyzed.
12. Chunking prefers Source Analysis ranges but never reparses source code.
13. Chunking makes oversized-input rejection or truncation explicit.
14. Chunk hashing, token estimation, and strategies are injected boundaries.
15. Text Index never accepts raw user FTS syntax.
16. SQLite FTS rows stay synchronized with canonical chunks through triggers.
17. Text Index revisions and chunk changes support incremental embedding.
18. Cancelled, rejected, and failed Chunking results preserve the last valid
    Text Index document.

## Deliberately kept outside these libraries

- Logging and telemetry are runtime concerns. The future V8 Engine should
  wrap these modules with spans, logs, and run identifiers.
- Graph persistence belongs in a future `RepoGraphStore`.
- Incremental graph mutation belongs in a future `RepoGraphUpdater`.
- Vector retrieval and LanceDB do not belong in Repo Map or Repo Graph.
- Focused traversal and impact analysis belong above the immutable graph.
- FTS persistence, embeddings, and vector writes consume Chunking output;
  Chunking does not own those stores.
- Text Index owns lexical persistence but not vector persistence, hybrid
  retrieval, or context budgeting.

This keeps every current module deterministic and directly testable from
input to output.

## Validation performed

- Strict TypeScript compilation
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- Runtime smoke build:
  - mock Code Index
  - Repo Graph construction and schema validation
  - Repo Map ranking, budgeting, and schema validation
  - TypeScript source analysis
  - Regex fallback analysis
  - unsupported-language analysis
  - bounded source-file reading
  - code, Markdown, and fallback text chunking
  - oversized-input truncation and rejection
  - cancellation and deterministic chunk IDs
  - SQLite FTS5 migration and atomic document replacement
  - lexical search with workspace isolation
  - unchanged and metadata-only update behavior
  - revisioned chunk change feed and chunk lookup
  - preservation of valid text data after rejected Chunking output
  - identical chunk IDs isolated safely across workspaces
  - legacy SQLite schema migration and idempotent re-migration
  - atomic Code Index insert, unchanged skip, and removal
