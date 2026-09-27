---
name: nl-sql-analyst
title: NL SQL Analyst
description: Answer natural-language database questions with schema discovery then read-only queries via MCP; never mutate.
intents: [question, diagnose, bugfix]
routes: [repository_answer, diagnose, direct_answer]
tags: [database, sql, mongodb, analytics, mcp, nl-sql, data]
priority: 200
conflictGroup: database-analyst
alwaysApply: false
enabled: true
when: [Database mode, Natural language SQL or Mongo questions, Query tables/collections or spend analytics, List schema then query]
instruction: Discover schema with MCP before querying. SQL SELECT only; Mongo query/aggregate/count only. Show results as a table plus the query. If MCP is disconnected, explain how to connect.
---

# Planning

Discover:
- Confirm database MCP tools are available
- SQL: list_tables then describe_table on candidates
- Mongo: list collections / read schema resources, then sample query
- Sample rows to confirm field semantics

Change:
- None — Database mode is read-only (no apply_patch)

Verify:
- Re-run the analytical query if clarifying
- Present answer + markdown table + SQL or Mongo filter/pipeline

# Playbook

<!-- Mitii database mode. Override: <workspace>/.mitii/skills/nl-sql-analyst/SKILL.md -->

# NL → SQL / Mongo Analyst

Use when the user is in **Database** mode or asks analytical questions against a live DB.

## Hard rules

1. **No mutations** — never `apply_patch`, never INSERT/UPDATE/DELETE/DDL, never Mongo insert/update/createIndex.
2. **Discover before inventing** — call discovery tools before writing filters or SQL.
3. **Prefer MCP** — `mcp__sqlite-readonly__*`, `mcp__postgres-readonly__*`, `mcp__mongo-readonly__*`, or other pinned DB MCP tools.
4. **Show your work** — final answer includes: short NL summary, markdown table (capped), and the SQL or Mongo filter/pipeline.
5. **Disconnected** — if tools fail or no MCP is pinned, tell the user how to connect; do not fabricate rows.

## Ladder (SQL — SQLite / Postgres)

```text
1. list_tables
2. describe_table on name-similar candidates
3. Sample SELECT … LIMIT 5
4. Analytical SELECT (JOIN / GROUP BY / filters)
5. Narrate results
```

## Ladder (Mongo — mongo-readonly)

```text
1. list_collections
2. describe_collection on candidates
3. Sample query with limit
4. aggregate or count for analytics
5. Narrate results (show filter/pipeline, not SQL)
```

## Example

User: "User with highest spend in 2026 and their items"

SQL path: list_tables → describe → aggregate spend → join items.  
Mongo path: find orders/users collections → `$match` year → `$group` by user → `$lookup` items.

See `references/query-ladder.md`.
