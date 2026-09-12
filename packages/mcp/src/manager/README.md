# Manager

Orchestrates MCP client lifecycle for Mitii hosts:

1. `sync(settings, workspaceRoot)` — connect enabled servers
2. Register tools as `mcp__{server}__{tool}` into a V8 `ToolRegistry`
3. Expose `toolDefinitions` for the model catalog
4. `dispose()` — tear down clients

Decision Policy still owns grants; this package only registers tools.
