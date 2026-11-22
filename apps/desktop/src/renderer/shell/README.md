# Shell

Activity-bar host: `WorkspacePanel`, `ActivityBarButton`, `ResizeHandle`.

`WorkspacePanel.tsx` is a thin facade (same export for `MainSection`). It owns
the active side (explorer / git / mcp / skills / recipes), the resizable side
column, and wires hooks to the feature panes:

- `explorer/` — `ExplorerTreePane`, `WorkspaceEditorPane`, `ExplorerContextMenu`
- `git/GitWorkingTreePane`, `mcp/McpManager`, `skills/SkillsManager`, `recipes/RecipesManager`

`hooks/useWorkspaceScm` holds the git status snapshot and the refresh token
shared by the explorer pane and the Source Control pane.

Chat layout stays in `App.tsx` + `renderer/chat/`.
