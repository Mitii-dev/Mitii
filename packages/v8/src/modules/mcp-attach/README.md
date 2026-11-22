# MCP attach (V8)

Per-turn MCP server scoping, parallel to skill pins (`@skill:`).

## Contract

| Input | Effect |
|---|---|
| No pins / no `@mcp:` | All grant-allowed `mcp__*` tools stay visible (today’s behavior) |
| `@mcp:excalidraw` and/or host `requiredMcpServerIds` | Only `mcp__excalidraw__*` tools are advertised |
| Ask / Plan | MCP hidden unless the user attaches via `@mcp:` / pins (read-safe tools only) |

Mentions are stripped from the user message before the engine runs.

## Layout

```text
constants.ts                 MAX_REQUIRED_MCP_SERVERS
parseRequiredMcpMentions.ts  @mcp: parse + merge
mcpToolAttachFilter.ts       mcp__{server}__* matching
contracts/                   public-module layout marker
index.ts
```

## Flow

```text
Host pins / @mcp:id
  → SDK mergeRequiredMcpServerIds
  → AgentEngineStartInput.requiredMcpServerIds
  → filterToolDefinitions(+ optional ToolGrant.allowedMcpServerIds)
```

Do **not** put this module in `@mitii/mcp` — V8 must not import the MCP client package.
