---
name: api-db-runtime-debug
title: API + DB Runtime Evidence
description: Discriminate empty/wrong API responses with live API and read-only DB probes before patching code.
intents: [bugfix, diagnose, trace, debug]
routes: [diagnose, execute]
tags: [debug, api, database, runtime-evidence, data-path]
priority: 195
conflictGroup: debug
alwaysApply: false
enabled: true
when: [API returns empty or wrong data, GET endpoint shows no users or empty list, Need to check database vs adapter vs DTO vs config, Runtime evidence for API and DB issues]
instruction: Stop the line. Probe API then DB schema then data before any apply_patch. Fill the evidence ledger for all five hypotheses; fix only the surviving cause; re-probe to verify.
---

# Planning

Discover:
- Reproduce the API symptom (status + body)
- Probe DB schema (tables / migrations present?)
- Probe DB data (COUNT + sample rows, read-only)

Change:
- Update the evidence ledger for all five hypotheses
- Patch only the surviving cause (data seed, adapter, DTO, or config)

Verify:
- Re-probe the API (and DB if the fix was data/schema)
- Stop once the symptom is gone

# Playbook

<!-- Mitii API + DB runtime evidence. Override: <workspace>/.mitii/skills/api-db-runtime-debug/SKILL.md -->

# API + DB Runtime Evidence

Use this when the user reports empty or wrong API data (for example `GET /v2/api/users` returns `[]` or missing fields). Static code reading alone cannot tell empty tables from DTO bugs — gather live evidence first.

## Hard rules

1. **Stop the line** — do not add features while the failure is unexplained.
2. **Probe before mutate** — do **not** call `apply_patch` (or other code mutations) until you have recorded **API** and **DB** probe results in the evidence ledger.
3. **One hypothesis at a time** — falsify with the cheapest discriminating probe.
4. **Prefer MCP DB tools** when connected (`mcp__sqlite__*`, `mcp__postgres__*`, `mcp__mongo__*`, or `mcp__sql__*`). Otherwise use `run_readonly_command` / L3 scripts / ephemeral probes under `.mitii/probes/<taskId>/`.
5. **Respect DB access** — refuse INSERT/UPDATE/DELETE/DDL on read-only tiers; use write MCP tools only when `MCP_DB_ACCESS=readwrite` / Database Read & write.
6. **No secrets in commits** — never write credentials into the repo; redact connection strings in chat.

## Ladder (always in this order)

```text
1. API probe     → status + body snippet (curl / fetch_url / run_readonly_command)
2. DB schema     → tables exist? migrations applied?
3. DB data       → COUNT(*) + sample rows (read-only)
4. Code path     → adapter → repository → DTO/mapper → filters/config
5. Fix + verify  → smallest fix for the surviving hypothesis; re-probe API
```

Treat `200` with an empty list or wrong shape as a **semantic failure**, not success.

## Five hypotheses

Read `references/hypothesis-ladder.md` for discriminators. Summarize in chat:

| Id | Hypothesis | Typical evidence |
|----|------------|------------------|
| H1 | No data in DB | API empty + COUNT=0 |
| H2 | DB not initialized | missing relation / migrate failure |
| H3 | Adapter not connected | connection / DSN / pool error |
| H4 | DTO / mapping issue | rows exist; HTTP empty/wrong shape |
| H5 | Config / pull wiring | rows + mapper OK; wrong filter/tenant/env |

## Evidence ledger

Maintain a short ledger (see `references/evidence-ledger.md`) with each hypothesis as `unknown | probed | confirmed | eliminated`. Do not claim a root cause until at least one discriminating probe ran.

## Tool posture

- **API:** `scripts/probe-api.sh`, `curl`, or `fetch_url` when the host grants network.
- **SQLite MCP:** `mcp__sqlite__list_tables`, `describe_table`, `query` (SELECT only on read-only tier).
- **Postgres MCP:** `mcp__postgres__*` (`MCP_DB_ACCESS`).
- **Mongo MCP:** `mcp__mongo__list_collections`, `describe_collection`, `query`, `aggregate`, `count` (`@mitii/mcp-mongo`).
- **Fallback:** write ephemeral scripts under `.mitii/probes/<taskId>/` via `write_file`, run with `run_readonly_command` only (`sqlite3`, `psql`, `curl`). Prefer MCP when enabled.
- **Code:** `read_file` / search / symbols only after schema+data probes (or after connection failure localizes H3).

## Prompt shape the host may send

```text
Symptom: GET {{endpoint}} returns empty or wrong data.
Entity/table: {{tableOrEntity}}
Use api-db-runtime-debug. Probe API → schema → data before any code patch.
```
