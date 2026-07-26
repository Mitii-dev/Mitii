/** Default methodology rules always injected into agent context (shipped with the extension). */
export const BUNDLED_PATH_RESOLUTION_RULES = `# Workspace path resolution (Mitii default)

Mitii auto-resolves missing read paths using the workspace index (SQLite), filesystem walks, and folder/file layout heuristics. Follow these rules so reads stay accurate without manual pinning.

## Before reading

1. Call **propose_file_scope** with the objective and candidate paths before reading or editing workspace files.
2. Only call **read_file** / **read_files** / **write_file** / **apply_patch** for paths accepted by **propose_file_scope**.
3. Use **resolve_path** as a fallback for one uncertain or ambiguous path, then pass the resolved candidate back through scope.
4. Use **search** / **search_batch** with \`scopeRoot\` for symbols or feature names.
5. Use **list_files** on the parent directory when exploring package layout (e.g. \`packages/foo/src/fields\`).
6. Only pass paths returned by tools, accepted scope, or auto-resolution — never invent flattened paths.

## Common monorepo layouts

- Feature folders often nest: \`fields/field-slider/field-slider.tsx\`, not \`fields/field-slider.tsx\`.
- Barrel files: \`index.ts\` inside a folder — read the folder listing first.
- Packages live under \`packages/<name>/\` — scope searches and reads to that root.

## When read_file auto-resolves

If you request a wrong but close path, Mitii may read the best indexed match and prefix the output with \`[Path auto-resolved]\`. Treat the resolved path as canonical for later edits.

## If resolution is ambiguous

Call **resolve_path** for the single ambiguous path and pick from ranked candidates, then confirm the file through **propose_file_scope**. Do not guess among multiple equally likely files.

## Accuracy over speed

Extra search, list, or resolve steps are expected. Do not skip grounding to save turns.
`;

export const BUNDLED_DEFAULT_RULES = BUNDLED_PATH_RESOLUTION_RULES;
