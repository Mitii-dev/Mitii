# agentmemory Integration

Mitii can use agentmemory as an optional MCP backend for cross-agent or team memory. The built-in Mitii memory remains the simplest option for one workspace because it uses local SQLite plus markdown auto-memory files.

Use agentmemory when you need shared recall across tools, a long-running memory server, or knowledge-graph style memory. Mitii connects through MCP:

```text
Mitii -> MCP streamable HTTP -> agentmemory -> iii-engine
```

## Enable

Start agentmemory on port `3111`, then run:

```bash
mitii memory connect agentmemory
```

This writes `.mitii/mcp.json`:

```json
{
  "mcpServers": {
    "agentmemory": {
      "type": "streamable-http",
      "url": "http://localhost:3111/mcp",
      "disabled": false
    }
  }
}
```

You can also enable the built-in `agentmemory` toggle in Mitii settings. It is off by default and does not conflict with the built-in `memory` MCP server.

## Verify

```bash
curl http://localhost:3111/agentmemory/livez
mitii agent "remember this project uses pnpm" --json --approval auto
```

If the server is not running, Mitii shows the MCP startup error in Settings. Data sent to agentmemory leaves Mitii's local SQLite store and enters the agentmemory service, so review enterprise retention and audit policies before enabling it for sensitive workspaces.
