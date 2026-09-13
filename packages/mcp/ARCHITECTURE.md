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

## Dependency graph

```text
apps/vscode --+
apps/cli -----+--> @mitii/mcp --> @mitii/v8
apps/acp -----+
@mitii/host --+   (automation executor)
```

Forbidden:

- `@mitii/mcp` → sdk | host | apps
- `@mitii/v8` → `@mitii/mcp`

## Module layout

```text
src/
  contracts/     # types only
  config/        # settings + builtins catalog
  transports/    # McpClient implementations
  manager/       # sync + ToolRegistry bridge
  index.ts
```

## Tool naming

Registered tools use a stable prefix:

```text
mcp__{serverId}__{toolName}
```

Unsafe characters in ids become `_`. Ask/Plan grants hide
`mcp__*` tools; Agent write grants expose all MCP tools, and Agent
read grants expose MCP tools that do not require workspace writes
(V8 `filterToolDefinitions`).

## Host responsibilities

Hosts still own:

- Workspace trust gates (VS Code)
- Secret / env injection into server `env` / `headers`
- Settings UI and SecretStorage
- Passing `registry` + `toolDefinitions` into SDK client creation

## Sibling package

MCP **server** (search / fetch / optional `memory_search`) lives next door:

```text
packages/mcp/web/   →  @mitii/mcp-web
```

The server must not import this client package (keeps it free of v8).
