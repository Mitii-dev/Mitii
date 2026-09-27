# @mitii/mcp-sqlite-readonly

Read-only SQLite MCP server for Mitii data-path debugging.

## Tools

| Tool | Description |
|------|-------------|
| `list_tables` | List user tables |
| `describe_table` | Column info for one table |
| `query` | SELECT-only query with row cap |

## Environment

| Var | Required | Description |
|-----|----------|-------------|
| `SQLITE_PATH` | yes | Path to the SQLite file |
| `SQLITE_MAX_ROWS` | no | Max rows returned (default 50, max 200) |

## Run

```bash
SQLITE_PATH=./app.db node bin/mitii-mcp-sqlite-readonly.js
```

Or via npx / Mitii MCP catalog entry `sqlite-readonly`.
