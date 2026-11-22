# Hypothesis ladder — empty / wrong API data

Walk API → schema → data → code. Falsify one hypothesis at a time with the cheapest probe.

## H1 — No data in DB

| Probe | Expected if true |
|-------|------------------|
| API | 200 + `[]` / empty collection |
| `SELECT COUNT(*) FROM <table>` | `0` |

**Fix direction:** seed data, upstream ingest, or confirm environment is meant to be empty — not DTO changes.

## H2 — DB not initialized

| Probe | Expected if true |
|-------|------------------|
| `list_tables` / `\dt` / migrate status | table missing |
| Query table | "relation does not exist" / no such table |

**Fix direction:** run migrations / init scripts; do not patch DTOs.

## H3 — Adapter not connected

| Probe | Expected if true |
|-------|------------------|
| DB open / ping | connection refused, auth failure, wrong host |
| App logs | pool never opens, DSN undefined |

**Fix direction:** env/DSN, DI wiring, connection module — verify same DB the API process uses.

## H4 — DTO / mapping issue

| Probe | Expected if true |
|-------|------------------|
| `COUNT(*)` / sample rows | rows present |
| Raw repository / SQL | returns entities |
| API body | empty, missing fields, or wrong shape |

**Fix direction:** serializer, DTO field names, soft-delete flags, null filtering in mapper.

## H5 — Config / pull wiring

| Probe | Expected if true |
|-------|------------------|
| Sample rows | present and look correct |
| Mapper unit path | maps correctly in isolation |
| API still wrong | wrong tenant, schema, feature flag, base path, filter, or env DB name |

**Fix direction:** query builder filters, tenancy, wrong database/schema in config, API version routing.

## Discriminating sequence (minimal)

```text
1. curl/API probe → capture status + body
2. list_tables / describe → H2?
3. COUNT + LIMIT sample → H1 vs H4/H5
4. If connection errors → H3
5. If rows OK and HTTP wrong → read adapter → DTO → config (H4 then H5)
```
