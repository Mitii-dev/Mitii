# Checkpoint

Host-durable freeze of Store on SUSPEND / heartbeat (§11.10).
Distinct from RestorePoint (workspace undo) and tool journal (§20.10).

## Session carry (P8 parity)

`RuntimeSessionStorePort` + default `InMemoryRuntimeSessionStore`:
- `executeRuntimeStart` saves `{ runId, message, mode, gateKind }`
- `executeRuntimeResume` loads carry when host omits `message` / `mode`

Full Store hydrate/save still engine-owned until gates checkpoint evacuate finishes.
