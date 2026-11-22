# MCP

MCP server manager UI. Wire types and manager live in `@mitii/mcp` (`contracts/`).

Desktop owns HTTP adapters (`/v1/mcp*`) and this UI only.

## Layout

- `McpManager.tsx` — thin facade (`McpManager`, props: `baseUrl`, `token`, `onRestartEngine`); mounts the pieces below. Sole importer is `WorkspacePanel`.
- `hooks/useMcpManager.ts` — state, reload, and mutations (toggle, delete, catalog install, custom add).
- `McpAddWizard.tsx` — wizard steps (source, catalog, secrets, custom transport/details).
- `McpServerGallery.tsx` — installed server tiles.
- `McpCatalogGallery.tsx` — essentials catalog tiles.
- `mcpManagerTypes.ts` — shared row/step types, `EMPTY_CUSTOM`, `CATEGORY_LABEL`.
