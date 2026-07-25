# V8 Source Analysis

This module converts one source file into deterministic structural facts:

- symbols
- imports
- references
- parser and language metadata
- bounded warnings

It does not read SQLite, write SQLite, create embeddings, build chunks,
emit telemetry, or manage workspace-wide parser state.

## File tree

```text
source-analysis/
├── extractors/
│   └── GenericImportExtractor.ts
├── parsers/
│   ├── RegexSourceParser.ts
│   ├── SourceParserRegistry.ts
│   ├── TreeSitterSourceParser.ts
│   └── TypeScriptSourceParser.ts
├── LanguageDetector.ts
├── SourceAnalysisBuilder.ts
├── SourceAnalysisFactory.ts
├── SourceAnalysisNormalizer.ts
├── SourceFactIdBuilder.ts
├── SourceFileReadError.ts
├── SourceFileReader.ts
├── constants.ts
├── index.ts
├── schema.ts
└── types.ts
```

## New files to add

All files in this directory are new V8 files. They intentionally replace the
responsibilities previously spread across:

- `TreeSitterService.ts`
- `SymbolExtractor.ts`
- `ImportExtractor.ts`
- `languageRegistry.ts`
- the single-file portion of `tsMorphScopedAst.ts`

`WorkspaceLanguageService` is not replaced here. Cross-file definition,
caller, and language-server behavior belongs in a later `code-navigation`
module.

## Default wiring

```ts
import {
  createSourceAnalysisBuilder,
} from "./source-analysis";

const analyzer =
  createSourceAnalysisBuilder();

const result = await analyzer.analyze({
  sourceId: "file:root:src%2Findex.ts",
  file: workspaceFile,
  content,
});
```

The default factory registers:

1. `TypeScriptSourceParser`
2. `RegexSourceParser`

When a `TreeSitterRuntimePort` is supplied, the factory inserts
`TreeSitterSourceParser` between them:

```ts
const analyzer =
  createSourceAnalysisBuilder({
    treeSitterRuntime,
  });
```

The host owns WASM loading, grammar caches, and disposal. This prevents
process-global parser state from leaking between workspaces or sessions.

## Parser fallback

Parsers are ordered by priority:

1. TypeScript compiler parser
2. Tree-sitter parser
3. Regex parser

If a parser throws, returns an invalid payload, or returns no facts for
non-empty content, the builder can attempt the next parser. Every fallback is
recorded in `warnings`; it is never silent.

## Deterministic output

`SourceAnalysis` intentionally excludes:

- timestamps
- elapsed duration
- logger fields
- telemetry span IDs
- mutable health state

The same input and parser versions therefore produce the same testable output.

## Next consumer

The next V8 module should be `code-indexing`:

```text
SourceAnalysis
      ↓
CodeIndexWritePort
      ↓
SqliteCodeIndexWriter
      ↓
CodeIndexUpdater
```

That module will convert local symbol IDs into public Code Index IDs and
persist symbols, imports, and references transactionally.

