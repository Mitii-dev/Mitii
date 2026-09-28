---
name: nl-sql-analyst
title: NL SQL Analyst
description: Answer natural-language database questions with schema discovery then queries via MCP; respect read-only vs read & write access tier.
intents: [question, diagnose, bugfix]
routes: [repository_answer, diagnose, direct_answer]
tags: [database, sql, mongodb, analytics, mcp, nl-sql, data]
priority: 200
conflictGroup: database-analyst
alwaysApply: false
enabled: true
when: [Database mode, Natural language SQL or Mongo questions, Query tables/collections or spend analytics, List schema then query]
instruction: Discover schema with MCP before querying. Respect DB access tier — read-only refuses mutations; read & write may use insert/update/delete/execute_write after confirming intent. Show results as a table plus the query. If MCP is disconnected, explain how to connect.
---

# Planning

Discover:
- Confirm database MCP tools are available
- SQL: list_tables then describe_table on candidates
- Mongo: list collections / read schema resources, then sample query
- Sample rows to confirm field semantics
- Check project rules for DB access tier (read-only vs read & write)

Change:
- Read-only: none — SELECT / find / aggregate / count only
- Read & write: DML via execute_write (SQL) or insert/update/delete/create_index (Mongo) when the user asks; never apply_patch

Verify:
- Re-run the analytical query if clarifying
- For mutations: show mutation summary and affected count
- Present answer + markdown table + SQL or Mongo filter/pipeline

# Playbook

<!-- Mitii database mode. Override: <workspace>/.mitii/skills/nl-sql-analyst/SKILL.md -->

# NL → SQL / Mongo Analyst

Use when the user is in **Database** mode or asks analytical questions against a live DB.

## Hard rules

1. **No application code edits** — never `apply_patch` or mutate source files in Database mode.
2. **Respect DB access tier** (see project rules / banner):
   - **Read-only** — never INSERT/UPDATE/DELETE/DDL; never Mongo insert/update/delete/createIndex. SELECT / WITH…SELECT and Mongo query/aggregate/count only.
   - **Read & write** — after confirming intent, use `execute_write` (SQL) or `insert` / `update` / `delete` / `create_index` (Mongo). Still refuse DROP/TRUNCATE unless explicitly requested. Show a short mutation summary and affected count.
3. **Discover before inventing** — call discovery tools before writing filters or SQL.
4. **Prefer MCP** — `mcp__sqlite__*`, `mcp__postgres__*`, `mcp__mongo__*`, `mcp__sql__*` (and legacy `*-readonly` ids when installed).
5. **Show your work** — final answer includes: short NL summary, markdown table (capped), and the SQL or Mongo filter/pipeline.
6. **Disconnected** — if tools fail or no MCP is pinned, tell the user how to connect; do not fabricate rows.

## Ladder (SQL — SQLite / Postgres)

```text
1. list_tables
2. describe_table on name-similar candidates
3. Sample SELECT … LIMIT 5
4. Analytical SELECT (JOIN / GROUP BY / filters)
5. (Read & write only) execute_write for INSERT/UPDATE/DELETE when asked
6. Narrate results
```

## Ladder (Mongo)

```text
1. list_collections
2. describe_collection on candidates
3. Sample query with limit
4. aggregate or count for analytics
5. (Read & write only) insert / update / delete / create_index when asked
6. Narrate results (show filter/pipeline, not SQL)
```

## Example

User: "User with highest spend in 2026 and their items"

SQL path: list_tables → describe → aggregate spend → join items.  
Mongo path: find orders/users collections → `$match` year → `$group` by user → `$lookup` items.

User (read & write): "Create 5 dummy users in the collection"

Mongo path: list_collections → confirm target → `insert` with 5 documents → report insertedCount.

See `references/query-ladder.md`.
