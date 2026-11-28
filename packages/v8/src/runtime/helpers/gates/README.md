# Gates hub

**One place** for suspend / complete (§10). Soft rails stay in `loop-rails/`.

| Entry | Job |
|---|---|
| `evaluateGates(phase, ctx)` | First matching predicate wins |
| `applyGate(verdict, ids, deps)` | Only checkpoint + complete result |

Predicates read structured `GateContext` flags only — never benchmark wording.
Resume handlers return a `ResumePlan`; flow executes it.

**Continue reasons (§10.3):** hosts see the trimmed `CONTINUE_REASONS` set.
Legacy engine strings (`exploration_stall`, `unfulfilled_execute`, …) map via
`mapLegacyContinueReason`. Rationale / reset copy lives in
`BuildBudgetWallRationale` / `BuildBudgetWallResetMessage`.

## Evacuate status

- Hub API live (P1)
- `shouldSuspendForPlanScopeFork` owned here; engine re-exports
- Engine suspends go through `engine/v8-engine/helpers/SaveSuspendedRun.ts`
  (normalizes hub kinds → store wire kinds). No raw `checkpointStore.save` left.
- Hollow post-plan task-list suspend consults `evaluateGates("after_plan", { hollowPlan })`
  before `saveSuspendedRun` (S10-EVAC partial).
- Engine call sites consult via `ConsultRuntimeGate`: early clarify, scope fork,
  plan approval, mutation approval, grant expansion, budget/continue walls.
  Checkpoint I/O remains `saveSuspendedRun` only.
