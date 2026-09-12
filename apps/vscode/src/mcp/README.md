# VS Code MCP host adapters

Thin VS Code-specific wrappers around [`@mitii/mcp`](../../../../packages/mcp).

Product MCP code (client + server + memory tools) lives under **`packages/mcp/`** only:

| Package path | Role |
|---|---|
| `packages/mcp` | `@mitii/mcp` client |
| `packages/mcp/web` | `@mitii/mcp-web` server (`web_search`, `fetch_url`, optional `memory_search`) |
| `packages/mcp/web/src/memory` | MCP memory tools |

| File (this folder) | Role |
|---|---|
| `manager.ts` | `getSharedMcpManager({ clientInfoName: 'mitii-vscode' })` |
| `builtins.ts` | Re-export builtin catalog |
| `stdioClient.ts` | Re-export stdio helpers (tests / legacy imports) |

Host-only concerns stay outside this folder:

- [`../mcpConfig.ts`](../mcpConfig.ts) — VS Code settings + `.mitii/mcp.json` persistence
- [`../ports.ts`](../ports.ts) — trust gate + `ToolRuntimePipeline` wiring
- Settings UI / SecretStorage in sidebar + package.json contributes

Do **not** put MCP protocol logic here — implement in `packages/mcp` / `packages/mcp/web`.
