# `@mitii/mcp` — Architecture

Status: MCP **client** kit (stdio + SSE + streamable-HTTP)  
Depends on: `@mitii/v8` (ToolRegistry / `defineTool` only), `zod`  
Must **not** depend on: `@mitii/sdk`, `@mitii/host`, apps

## Purpose

Own the **MCP wire + registration** path so every Mitii host shares one
implementation. V8 stays free of JSON-RPC / process spawn / HTTP SSE.

```text
.mitii/mcp.json
      │
      ▼
 @mitii/mcp
   config  → parse settings
   transports → connect (stdio | sse | http)
   manager → register mcp__* into ToolRegistry
      │
      ▼
 ToolRuntimePipeline + Decision Policy
```

## Sibling packages (DB servers)

```text
packages/mcp/
  src/           → @mitii/mcp              (client core)
  web/           → @mitii/mcp-web
  sqlite/        → @mitii/mcp-sqlite
  postgres/      → @mitii/mcp-postgres
  mongo/         → @mitii/mcp-mongo
```

Access mode (all three DB servers):

| `MCP_DB_ACCESS` | Behavior |
|-----------------|----------|
| `readonly` (default) | Discovery + SELECT / find / aggregate / count |
| `readwrite` | + DML (`execute_write` or insert/update/delete/create_index) |

Database mode UI exposes **Read-only** / **Read & write** and stamps `MCP_DB_ACCESS` onto installed DB servers. Write tools are tagged `requiresWorkspaceWrite` per-tool so Ask grants keep discovery tools.

Legacy catalog ids `*-readonly` still install and map to the same packages.

## Tool naming

```text
mcp__{serverId}__{toolName}
```
