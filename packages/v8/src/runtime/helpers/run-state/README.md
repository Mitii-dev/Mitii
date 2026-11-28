# RunState (storeroom)

Live inventory for one run visit (§11.10). **Not** the Briefcase.

| Layer | Role |
|---|---|
| Briefcase | Ephemeral pack for one model turn |
| **RunState** | In-process slices via `StoreManager` |
| Checkpoint | Durable pause snapshot (gates / optional heartbeat) |
| Memory | Cross-run durable facts |

## Lost context (A–E)

| Case | Handling |
|---|---|
| **A** Window full | Compact into Briefcase; RunState keeps fuller transcript/TaskList |
| **B** Need repo/skills again | Light enrich refresh or readonly tools under grant |
| **C** Provider failure | `continue_required` / `provider_unavailable` + checkpoint — don’t wipe |
| **D** Repo edited while suspended | `on_resume` → `checkpoint_conflict_required` |
| **E** Model thrash | Soft rails then continue wall + checkpoint |

## Heartbeat (S11-HEART)

Non-user checkpoint (`suspensionKind: "heartbeat"`). Defaults ON for
`agent`+`execute` / plan discovery; OFF for ask/clarify/answer. Host may set
`heartbeat: false`. Resume = continue loop — no decision payload.

## API

- `RunState.from(store)` — typed get/set over known keys
- `buildCheckpointFromRunState` — embed `storeSnapshot` in gate payload
- `hydrateRunStateFromCheckpoint` — restore when payload carries snapshot
