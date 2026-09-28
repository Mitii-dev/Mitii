# `@mitii/mcp-sql`

Multi-dialect SQL MCP for Mitii Database mode (Mitii-style Node stdio server).

Read tools: `list_tables`, `describe_table`, `list_foreign_keys`, `sample_rows`,
`query`, `explain_query`, `ping` (plus `list_connections`). Write tier via
Mitii `MCP_DB_ACCESS=readwrite` → `execute_write`.

## Dialects

| Dialect | URI examples |
|---------|----------------|
| PostgreSQL | `postgresql://user:pass@host:5432/db` |
| MySQL | `mysql://user:pass@host:3306/db` |
| MariaDB | `mariadb://user:pass@host:3306/db` |
| SQLite | `/path/to/app.db` or `sqlite:/path/to/app.db` |

## Access mode

| `MCP_DB_ACCESS` | Tools |
|-----------------|-------|
| `readonly` (default) | `list_connections`, `list_tables`, `describe_table`, `list_foreign_keys`, `sample_rows`, `query`, `explain_query`, `ping` |
| `readwrite` | + `execute_write` (INSERT / UPDATE / DELETE / REPLACE; no DDL) |

## Env

**Single connection**

| Variable | Required | Notes |
|----------|----------|-------|
| `SQL_MCP_URI` | yes* | Also accepts `DATABASE_URI`, `MYSQL_URI`, `SQLITE_PATH` |
| `SQL_MCP_DIALECT` | no | `postgresql` / `mysql` / `mariadb` / `sqlite` (inferred from URI) |
| `SQL_MCP_NAME` | no | Profile name (default `default`) |
| `MCP_DB_ACCESS` | no | `readonly` or `readwrite` |
| `SQL_MAX_ROWS` | no | Cap rows (default 50, max 200) |

**Multi connection**

```bash
SQL_MCP_CONNECTIONS='[
  {"name":"analytics","uri":"postgresql://ro@db/analytics"},
  {"name":"legacy","uri":"mysql://ro@db/legacy","dialect":"mysql"}
]'
```

Pass `connection` on tools when more than one profile is configured.

## Run

```bash
SQL_MCP_URI=postgresql://user:pass@localhost:5432/mydb MCP_DB_ACCESS=readonly \
  node bin/mitii-mcp-sql.js
```

Catalog id: `sql`.

\* Required unless `SQL_MCP_CONNECTIONS` is set.
