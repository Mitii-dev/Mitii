# Explorer

File tree, editor tabs, context menu, diff view and code editor. The
activity-bar host `shell/WorkspacePanel` mounts these pieces and wires the hooks.

Engine: `engine/explorer/` (workspace fs + watch).

## Layout

- `explorerTypes.ts` — `TreeEntry`, `OpenTab`, `CreateDraft`, menu/clipboard types.
- `pathUtils.ts`, `flattenVisible.ts` — pure helpers (unit-tested).
- `hooks/useExplorerTree.ts` — root/children/expanded state, `loadDir`, FS watch + agent invalidate.
- `hooks/useEditorTabs.ts` — tabs, open/save/autosave, diff tabs, path remap.
- `hooks/useExplorerFsOps.ts` — selection, create/rename/delete/clipboard/reveal, tree keyboard.
- `ExplorerTreePane.tsx` / `ExplorerTreeRows.tsx` — side UI and virtualized rows.
- `ExplorerContextMenu.tsx` — right-click menu.
- `WorkspaceEditorPane.tsx` — tab strip + `DiffView` / `CodeEditor` / markdown preview / hero.

Hooks never import `shell/` hosts; the facade passes callbacks (errors, git refresh, side changes).

## `@` path mentions

Composer `@` search uses a **query-first BFS** (with a time/visit budget) so
folders like `Mitii/packages/v8/src/modules/request-intake` stay findable even
when the workspace root is a multi-repo sandbox (`ai-agents` with `*-ref`
clones). Spaced queries (`@request intake`) normalize to hyphen form.
Typing after `@` switches the composer to path-only suggestions.


