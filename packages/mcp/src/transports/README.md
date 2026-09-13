# Transports

MCP wire clients. Each implements `McpClient` from `../contracts`.

| File | Transport | When to use |
|---|---|---|
| `stdio.ts` | Local child process (JSON-RPC + Content-Length) | `npx` / local MCP servers |
| `sse.ts` | HTTP GET event-stream + POST | Legacy remote SSE servers |
| `streamableHttp.ts` | Single-endpoint POST | Modern streamable-HTTP servers |

`McpManager` selects a transport from `McpServerConfig.transport`.
