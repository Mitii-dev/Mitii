# V8 Engine promotion

`v8` is the sole orchestrator. The `legacy` setting still parses but always
resolves to `v8`.

## Defaults

| Surface | Default | Notes |
|---------|---------|-------|
| `composeAgentEngine()` | `v8` | `implementation: "legacy"` → v8 |
| `createMitiiClient()` | `v8` | `engineImplementation: "legacy"` → v8 |
| `mitii.engine.implementation` | `v8` | `legacy` → v8 |
| `MITII_ENGINE_IMPLEMENTATION` | `v8` | `legacy` → v8 |

Constant: `V8_ENGINE_PROMOTION` in `promotion.ts`.

## Ship rails

| Rail | Notes |
|------|--------|
| prepareTurn | Compaction / working set / epoch every model turn |
| Rejected-mutation soft recovery | `maxRejectedMutationRecoveries` |
| Soft must-read nudge | `maxMustReadNudges` (never evidence-spend lock) |
| Truncation vs reasoning | `decideTruncationRecovery`; `finishReason=reasoning_budget` |
| Reasoning-abort cap | `maxReasoningAbortRecoveries` → host Continue |

### Dropped legacy knobs (never port)

See `V8_ENGINE_DROPPED_LEGACY_KEYS` in `policy.ts`:

- `maxPostNudgeEvidenceReadTurns`
- `maxReadOnlyMutationRetryAttempts`
- `maxMutationLockRecoveries` / `maxMutationLockAutoStubBatches`
- `maxReasoningProgressBudgetExceedancesBeforeMutationLock`
- preflight repair lock / exploration-stall matrix knobs

## Always-on goldens

Path: `packages/v8/src/engine/v8-engine/tests/`
(includes `eval/alwaysOn.goldens.spec.ts`, `recoveryBudgets.spec.ts`).
