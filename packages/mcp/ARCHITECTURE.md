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

Unsafe characters in ids become `_`. Agent write grants expose all MCP
tools, and Agent read grants expose MCP tools that do not require workspace
writes (V8 `filterToolDefinitions`). Ask/Plan hide MCP unless the user
explicitly attaches servers via `@mcp:` / pins (still read-safe only).

### Per-turn attach (`@mcp:`)

Hosts may pass `requiredMcpServerIds` (pins / `@mcp:excalidraw`). When
non-empty, V8 scopes the catalog and grant to those server ids only.
Empty = all enabled servers under the grant. Parsing lives in
`packages/v8/src/modules/mcp-attach/` (V8 must not import this package).

## Manager layout

```text
manager/
  McpManager.ts              sync / snapshot / dispose
  createMcpClient.ts         transport factory
  registerMcpServerTools.ts  mcp__* ToolRegistry bridge
  mcpServerEffects.ts        write vs read-only tagging
  mcpManagerTypes.ts         snapshot + result event types
  sharedMcpManager.ts        host singleton
  toolName.ts
```

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
