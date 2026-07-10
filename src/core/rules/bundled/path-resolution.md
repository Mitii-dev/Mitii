# Workspace path resolution (Mitii default)

Mitii auto-resolves missing read paths using the workspace index (SQLite), filesystem walks, and folder/file layout heuristics. Follow these rules so reads stay accurate without manual pinning.

## Before reading

1. Prefer **resolve_path** when the exact path is uncertain.
2. Use **search** / **search_batch** with `scopeRoot` for symbols or feature names.
3. Use **list_files** on the parent directory when exploring package layout (e.g. `packages/foo/src/fields`).
4. Only pass paths returned by tools or auto-resolution — never invent flattened paths.

## Common monorepo layouts

- Feature folders often nest: `fields/field-slider/field-slider.tsx`, not `fields/field-slider.tsx`.
- Barrel files: `index.ts` inside a folder — read the folder listing first.
- Packages live under `packages/<name>/` — scope searches and reads to that root.

## When read_file auto-resolves

If you request a wrong but close path, Mitii may read the best indexed match and prefix the output with `[Path auto-resolved]`. Treat the resolved path as canonical for later edits.

## If resolution is ambiguous

Call **resolve_path** and pick from ranked candidates. Do not guess among multiple equally likely files.

## Accuracy over speed

Extra search, list, or resolve steps are expected. Do not skip grounding to save turns.
