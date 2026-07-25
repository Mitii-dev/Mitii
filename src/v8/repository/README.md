# V8 Repository Intelligence Replacement

This bundle contains aligned replacements for:

- `code-index`
- `code-indexing`
- `repo-graph`
- `repo-map`
- `source-analysis`

## Complete file tree

```text
v8-repository-intelligence/
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
└── README.md
```

The implementation follows these boundaries:

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

## Deliberately kept outside these libraries

- Logging and telemetry are runtime concerns. The future V8 Engine should
  wrap these modules with spans, logs, and run identifiers.
- Graph persistence belongs in a future `RepoGraphStore`.
- Incremental graph mutation belongs in a future `RepoGraphUpdater`.
- Vector retrieval and LanceDB do not belong in Repo Map or Repo Graph.
- Focused traversal and impact analysis belong above the immutable graph.

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
  - legacy SQLite schema migration and idempotent re-migration
  - atomic Code Index insert, unchanged skip, and removal
