# `@mitii/mcp-web` — Architecture

Status: stdio MCP **server** under `packages/mcp/web`  
Depends on: `@mitii/search-kit`, `zod`  
Must **not** depend on: `@mitii/v8`, `@mitii/sdk`, `@mitii/host`, `@mitii/mcp` (client)

## Purpose

```text
MCP client (any)
      │  tools/call web_search | fetch_url | memory_search?
      ▼
 @mitii/mcp-web  (packages/mcp/web)
      ├─► @mitii/search-kit
      └─► optional soft-parse of .mitii/memory/facts.json (shareable only)
```

Sibling of the client package:

```text
packages/mcp/          ← @mitii/mcp (client)
packages/mcp/web/      ← @mitii/mcp-web (this server)
```

## Non-goals

- Agent loop, grants, or Decision Policy
- Write/mutate memory (search only; private facts never returned)
- HTTP/SSE server transport in v1 (stdio only)
