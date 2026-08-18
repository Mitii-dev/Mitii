# Tree-sitter query catalog

V8 owns **query text**. The host owns **WASM grammars**. `TreeSitterSourceParser` injects catalog strings into `TreeSitterRuntimePort.parse({ symbolQuery, referenceQuery })`.

## Why this exists

A 30k-token window only has ~5.9k repository tokens. Repo Map / Repo Graph rank files from symbols and call edges. Thin queries (every `const`, no `obj.method()` calls, no Lua) fill that budget with the wrong files.

These queries are adapted from aider `tags.scm` files so ranking follows the call chain instead of identifier noise.

## Capture contract

The host runtime accepts both styles:

| Role | Mitii | Aider tags |
|---|---|---|
| Symbol name | `@name` | `@name.definition.<kind>` |
| Symbol node | `@definition` | `@definition.<kind>` |
| Reference name | `@reference.<kind>` | `@name.reference.<kind>` |

Supported reference kinds: `call`, `construct`, `type`, `read`, `write`. Aider `class` / `method` / `send` map to `construct` or `call`.

## Adding a language

1. Add a tags source to `bundledTreeSitterQueries.ts` (keep aider capture names).
2. Map the grammar WASM in host `WEB_TREE_SITTER_GRAMMAR_WASM_BY_LANGUAGE` and `scripts/stage-tree-sitter-wasm.cjs`.
3. If it is not a first-class `LANGUAGE_IDS` value, add a dialect extension in `SOURCE_LANGUAGE_DIALECT_EXTENSIONS`.
4. Do not add `#strip!` / `#select-adjacent!` / `#is-not?` — `adaptTreeSitterTagsQuery` strips them, but they are tags-only.

Do not expand `LANGUAGE_IDS` unless chunking, catalogs, and baseline fixtures are updated in the same change.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-state/internal/source-analysis/queries
```
