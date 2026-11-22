# Evidence ledger (API + DB)

Keep one short ledger in the reply (or `.mitii/probes/<taskId>/ledger.md`). Update states; do not erase prior probes.

## Campaign facts

- Symptom (method + path + observed body/status)
- Base URL / env (no secrets)
- Entity / table name
- DB connector used (MCP server id or CLI)
- Task / probe directory (if any)

## Hypothesis states

For each of H1–H5 use exactly one:

- **unknown** — not yet tested
- **probed** — probe ran; inconclusive
- **confirmed** — evidence supports this as root cause
- **eliminated** — evidence rules it out

## Template

```text
Symptom: GET /v2/api/users → 200 []
API probe: <status, body snippet, command>
Schema probe: <tables / error>
Data probe: <COUNT, sample cols (redact PII)>
Ledger:
  H1 no-data: eliminated|confirmed|probed|unknown — <note>
  H2 not-init: ...
  H3 adapter: ...
  H4 dto: ...
  H5 config: ...
Surviving: Hx — <one sentence>
Fix plan: <smallest change>
Verify: <re-probe command>
```

## Rules

- Do not mark **confirmed** without a discriminating probe.
- Prefer a single **confirmed** hypothesis; if two remain, run one more probe.
- After a fix, record verify API (and DB if data/schema changed) before claiming done.
