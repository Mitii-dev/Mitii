# Query ladder (NL → DB)

## SQL discover (SQLite / Postgres)

1. `list_tables` (or dialect equivalent)
2. Rank tables by name similarity to the question (user, order, item, spend, payment)
3. `describe_table` for 1–4 candidates
4. Optional: `SELECT * FROM t LIMIT 5` to confirm units/dates

## Mongo discover (mongo-readonly / mcp-mongo-server)

1. List collections (MCP resources or equivalent)
2. Read inferred schema for 1–4 candidates
3. Sample `query` with `{ limit: 5 }`
4. Prefer `aggregate` / `count` for analytics — never `insert` / `update` / `createIndex`

## Analyze

Build queries **only** from discovered names. Prefer:

- Explicit JOINs / `$lookup` on known keys
- Date filters with known field types
- `LIMIT` / `limit` on final result sets

## Present

```text
Answer: <one sentence>
Results:
| col | …
Query:
```sql
…   # or Mongo filter / pipeline JSON
```
```

## Errors

On "no such column/table/collection": re-describe and rewrite. Never invent schema.
