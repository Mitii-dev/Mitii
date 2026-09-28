# Explorer

File tree UI lives in `shell/WorkspacePanel` today (always-virtualized flat
list). Diff and code editor live here.

Engine: `engine/explorer/` (workspace fs + watch). Prefer extracting the tree
into this folder next.

## `@` path mentions

Composer `@` search uses a **query-first BFS** (with a time/visit budget) so
folders like `Mitii/packages/v8/src/modules/request-intake` stay findable even
when the workspace root is a multi-repo sandbox (`ai-agents` with `*-ref`
clones). Spaced queries (`@request intake`) normalize to hyphen form.
Typing after `@` switches the composer to path-only suggestions.


