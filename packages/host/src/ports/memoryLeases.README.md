# Memory leases (host)

Durable resource locks under `<workspace>/.mitii/memory/`.

- `leases.json` records readable lease state/history.
- `lease-locks/*.lock/` directories are the atomic cross-process lock points.

## Resources

| Resource | Used by |
|---|---|
| `memory:consolidate` | `runMemoryConsolidateWithLease` / cron hosts |
| `memory:approve_pending` | `approvePendingMemory` |

## Semantics (agentmemory-inspired)

- Acquire with TTL (default 10m, max 60m)
- Same holder re-acquire is idempotent
- Other holders blocked until release or expiry
- Separate host processes contend via atomic lock-directory creation
- `withLease` always releases (best-effort) in `finally`

Does not live in V8 — host owns concurrency for durable memory files.
