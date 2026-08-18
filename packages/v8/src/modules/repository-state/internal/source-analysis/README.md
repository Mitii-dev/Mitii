# Source Analysis

Source Analysis extracts structured facts from source files: language, parser quality, symbols, imports, references, and warnings. These facts feed Code Indexing, Repo Graph, Repo Map, Code Navigation, and Change Impact.

## What This Module Does

- Detects language from path and optional override.
- Chooses an appropriate parser.
- Parses symbols, imports, and references.
- Falls back when rich parsing is unavailable.
- Normalizes local ids, ranges, and fact shapes.
- Emits quality/status/warning metadata.

## Structure

```text
source-analysis/
  SourceAnalysisBuilder.ts
  SourceAnalysisFactory.ts
  SourceFileReader.ts
  LanguageDetector.ts
  SourceAnalysisNormalizer.ts
  queries/
    TreeSitterQueryCatalog.ts
    adaptTreeSitterTagsQuery.ts
    bundledTreeSitterQueries.ts
  parsers/
    SourceParserRegistry.ts
    TypeScriptSourceParser.ts
    TreeSitterSourceParser.ts
    RegexSourceParser.ts
  extractors/
    GenericImportExtractor.ts
  schema.ts
  types.ts
```

## Types And Contracts

- `SourceAnalysisInput`: source id, workspace file entry, content, optional language, reference candidates, and abort signal.
- `SourceAnalysis`: schema version, source id, root/path, language source, parser id, quality, status, symbols, imports, references, and warnings.
- `SourceAnalysisSymbol`: symbol name/kind/range/local id/export data.
- `SourceAnalysisImport`: imported module/specifier information.
- `SourceAnalysisReference`: reference/call/use facts.
- `SourceParser`: parser contract for language-specific analysis.

## Technical Details

- `LanguageDetector` combines path and override evidence.
- `SourceParserRegistry` chooses parser implementation.
- TypeScript parsing is preferred for TS/TSX when available.
- Tree-sitter queries live in `queries/`. The parser injects catalog strings into the host `TreeSitterRuntimePort`. Queries accept aider `@name.definition.*` / `@name.reference.*` captures as well as Mitii `@name` / `@definition` / `@reference.*`.
- Tree-sitter and regex paths provide broader/fallback coverage.
- `SourceAnalysisNormalizer` keeps output deterministic.
- Unsupported or failed analysis returns structured status/warnings where possible.

## Ownership Boundaries

Owns source fact extraction from file content.

Does not own file selection, index writes, repository-state publication, retrieval ranking, or prompt assembly.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-state/internal/source-analysis
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

SourceAnalysisInput -> SourceAnalysis:

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

Source Analysis result returns a result like this:

```json
{
  "schemaVersion": 1,
  "sourceId": "root:src/LoginForm.tsx",
  "rootId": "root",
  "relativePath": "src/LoginForm.tsx",
  "language": "typescript",
  "languageSource": "extension",
  "parserId": "typescript",
  "quality": "full",
  "status": "complete",
  "symbols": [{ "localId": "LoginForm", "name": "LoginForm", "kind": "function", "startLine": 12, "endLine": 84 }],
  "imports": [{ "specifier": "@/components/Button", "kind": "static" }],
  "references": [{ "symbolName": "setIsSubmitting", "kind": "write", "startLine": 25 }],
  "warnings": []
}
```
