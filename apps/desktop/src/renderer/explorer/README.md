# Explorer (desktop)

Workspace file tree + open/edit/save.

| Layer | Location |
|---|---|
| UI | Tree still in `renderer/shell/WorkspacePanel.tsx` — extract to this folder when touching explorer UI |
| Engine | `engine/explorer/` (`workspaceFs`, `workspaceWatch`) |
| HTTP | `/v1/workspace/*` in `engine/server.ts` |

Contract: engine talks to disk; renderer only uses `api.ts`. No `@mitii/v8` imports here.
