# Execution seed

Trusted paths/symbols/causes that feed mutate-readiness and post-plan task lists.

## Owns
- Resolve / refine / format execution seeds
- Apply seed onto TaskList write/mustRead
- Recover plan Change targets from seed
- Ensure concrete task list from plan

## Does not own
- Post-plan hollow-plan suspend orchestration (`applyPostPlanTaskListGate` stays
  engine — uses SaveSuspendedRun / runtime consult)
- User-path vs preflight priority (→ `helpers/user-path-priority`)

## Engine
`engine/.../modules/execution-seed` re-exports this folder (+ gate stays local).
