# `@mitii/mcp-postgres-readonly`

First-party Mitii MCP **stdio** server for **read-only** Postgres probes (same tool shape as SQLite).

## Tools

| Tool | Purpose |
|------|---------|
| `list_tables` | Public-schema base tables |
| `describe_table` | Column metadata from `information_schema` |
| `query` | SELECT / WITH…SELECT only |

## Env

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URI` | yes | `postgresql://` / `postgres://` (aliases: `POSTGRES_URI`, `DATABASE_URL`) |
| `POSTGRES_MAX_ROWS` | no | Cap rows (default 50, max 200) |

## Run

```bash
DATABASE_URI=postgresql://user:pass@localhost:5432/mydb node bin/mitii-mcp-postgres-readonly.js
```

Catalog id: `postgres-readonly` → `npx -y @mitii/mcp-postgres-readonly`.

Sessions request `default_transaction_read_only=on`; SQL mutations are still rejected in-process.
