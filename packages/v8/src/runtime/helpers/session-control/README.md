# Session control

Intake meta commands (`/stop`, `/new`, `/clear`, `/compact`, `/help`, `/status`,
`/resume`). Hosts persist side effects (transcript clear/replace).

## Owns
- Meta-command dispatch + user-facing answers
- Forced compact orchestration (ladder injected via `compactMessages` port)

## Does not own
- Compaction ladder implementation (`compactModelLoopMessages` stays engine)
- Host session storage

## Engine
`engine/.../modules/session-control` injects `compactModelLoopMessages` and
re-exports this folder.
