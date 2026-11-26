# Run evidence

Ledger helpers for discovery / plan / tool / verify / stop evidence on a run.

## Owns
- `createInitialRunEvidence` / `finalizeRunEvidence` / `record*Evidence`
- Clamp + clip limits aligned with `RunEvidence` schema
- Issue merge / diagnostic keys / ledger upsert

## Does not own
- Engine pipeline when to record
- Discovery observation collector implementation (engine internal)
