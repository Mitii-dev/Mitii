# MCP (desktop)

MCP server manager UI. Runtime client is `@mitii/mcp` (injected in `createDesktopHost`).

| Layer | Location |
|---|---|
| UI | `McpManager.tsx`, `McpAppCard.tsx` |
| Engine | routes `/v1/mcp*` in `server.ts` + host MCP manager |
| Package | `packages/mcp` |

Do not reimplement ToolRegistry bridging in the renderer.
