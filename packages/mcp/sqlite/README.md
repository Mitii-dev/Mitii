# `@mitii/mcp-sqlite`

First-party Mitii MCP **stdio** server for SQLite (Database mode).

## Access mode

| `MCP_DB_ACCESS` | Tools |
|-----------------|-------|
| `readonly` (default) | `list_tables`, `describe_table`, `query` (SELECT only) |
| `readwrite` | + `execute_write` |

## Environment

| Var | Required | Description |
|-----|----------|-------------|
| `SQLITE_PATH` | yes | Path to the SQLite file |
| `MCP_DB_ACCESS` | no | `readonly` (default) or `readwrite` |
| `SQLITE_MAX_ROWS` | no | Max rows returned (default 50, max 200) |

## Run

```bash
SQLITE_PATH=./app.db MCP_DB_ACCESS=readonly node bin/mitii-mcp-sqlite.js
```

Catalog id: `sqlite`.
