# Gates hub

**One place** for suspend / complete (§10). Soft rails stay in `loop-rails/`.

| Entry | Job |
|---|---|
| `evaluateGates(phase, ctx)` | First matching predicate wins |
| `applyGate(verdict, ids, deps)` | Only checkpoint + complete result |

Predicates read structured `GateContext` flags only — never benchmark wording.
Resume handlers return a `ResumePlan`; flow executes it.

## Evacuate status

- Hub API live (P1)
- `shouldSuspendForPlanScopeFork` owned here; engine re-exports
- Engine suspends go through `engine/v8-engine/helpers/SaveSuspendedRun.ts`
  (normalizes hub kinds → store wire kinds). No raw `checkpointStore.save` left.
