# Explorer

File tree UI lives in `shell/WorkspacePanel` today (always-virtualized flat
list). Diff and code editor live here.

Engine: `engine/explorer/` (workspace fs + watch). Prefer extracting the tree
into this folder next.
