# V8 Engine promotion

**Status:** `promoted` — `v8` is the sole orchestrator (Phase 10). The `legacy` setting still parses but always resolves to `v8`.

**Ownership plan:** `project-goals/v8-engine-ownership-plan.md` (Phases 7–10).

## Defaults

| Surface | Default | Notes |
|---------|---------|-------|
| `composeAgentEngine()` | `v8` | `implementation: "legacy"` → v8 |
| `createMitiiClient()` | `v8` | `engineImplementation: "legacy"` → v8 |
| `mitii.engine.implementation` | `v8` | `legacy` → v8 |
| `MITII_ENGINE_IMPLEMENTATION` | `v8` | `legacy` → v8 |

Constant: `V8_ENGINE_PROMOTION` in `packages/v8/src/engine/v8-engine/promotion.ts`.

## Phase 7 ship notes (tier-1 harness)

| Rail | Status |
|------|--------|
| prepareTurn (compaction / working set / epoch) | wired every model turn |
| Rejected-mutation soft recovery | `maxRejectedMutationRecoveries` |
| Soft must-read nudge | `maxMustReadNudges` (never evidence-spend lock) |
| Truncation vs reasoning | single `decideTruncationRecovery`; `finishReason=reasoning_budget` (not `length`) |
| Reasoning-abort cap | `maxReasoningAbortRecoveries` → host Continue |

### Dropped legacy knobs (never port)

See `V8_ENGINE_DROPPED_LEGACY_KEYS` in `policy.ts`:

- `maxPostNudgeEvidenceReadTurns`
- `maxReadOnlyMutationRetryAttempts`
- `maxMutationLockRecoveries` / `maxMutationLockAutoStubBatches`
- `maxReasoningProgressBudgetExceedancesBeforeMutationLock`
- preflight repair lock / exploration-stall matrix knobs

## Always-on goldens (unit CI)

Path: `packages/v8/src/engine/v8-engine/tests/` (includes `eval/alwaysOn.goldens.spec.ts`, `phase7.tier1.spec.ts`).

Covers rewrite-plan §7.2 + ownership T10–T12 with **stub LLMs only** (no live paid APIs).

## Curated-40

Catalog: `packages/v8/src/engine/v8-engine/tests/eval/curated-40.json`  
Source: `project-goals/agent-engine-test-prompts.md`

**Pass bar:** mutation completed or correct ask answer; never mark green on Continue alone when mutation was required.

Nightly: `pnpm --filter @mitii/v8 run eval:nightly` (also `.github/workflows/v8-engine-eval.yml`).

Live/recorded product runs against the 40 prompts are optional drivers — not unit CI.

## Soak

`soakDaysRequired: 7` — keep watching always-on goldens + nightly. Phase 10 removed the legacy orchestrator tree; `legacy` settings are compatibility aliases to v8.

## Do not

- Resume a run after flipping implementations (no cross-engine resume guarantee).
- Weaken product tests to make the agent look green.
- Call live paid APIs from unit CI.
- Reintroduce Dropped mutation-lock / preflight-repair / evidence-spend rails.
