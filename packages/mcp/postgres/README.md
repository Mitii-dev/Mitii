# `@mitii/mcp-postgres`

First-party Mitii MCP **stdio** server for Postgres (Database mode).

## Access mode

| `MCP_DB_ACCESS` | Tools |
|-----------------|-------|
| `readonly` (default) | `list_tables`, `describe_table`, `query` (SELECT / WITH…SELECT) |
| `readwrite` | + `execute_write` |

## Env

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URI` | yes | `postgresql://` / `postgres://` (aliases: `POSTGRES_URI`, `DATABASE_URL`) |
| `MCP_DB_ACCESS` | no | `readonly` (default) or `readwrite` |
| `POSTGRES_MAX_ROWS` | no | Cap rows (default 50, max 200) |

## Run

```bash
DATABASE_URI=postgresql://user:pass@localhost:5432/mydb MCP_DB_ACCESS=readonly \
  node bin/mitii-mcp-postgres.js
```

Catalog id: `postgres`.
