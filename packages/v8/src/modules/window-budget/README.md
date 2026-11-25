# Window Budget

**One job:** turn a model context window size `W` into a `WindowPolicy` number sheet.

```text
W in  →  WindowBudgetPipeline.derive()  →  WindowPolicy out
```

This module does **not** run the agent loop. It only publishes numbers.

---

## How to read this folder

```text
window-budget/
  pipeline/WindowBudgetPipeline.ts   ← start here (ONE class) — calls the flow
  actions/
    1-resolve-policy.ts              ← real function: merge tables
    2-derive-allocation.ts           ← real function: bake WindowPolicy
    3-resolve-generation-ceiling.ts  ← real function: output ceiling helper
  policy/                            ← tables only (bands, effort, mode…)
  constants.ts                       ← reason codes + stage names (no magic strings)
  contracts/                         ← input / WindowPolicy / errors / ModuleLoggerPort
  tests/{contract,unit,golden}
```

Open `pipeline/` → where steps are **called**.  
Open `actions/` top→bottom → step **implementations**.  
Open `policy/` → the knobs.  
Open `constants.ts` → stable reason/stage strings.

---

## Two kinds of numbers on `WindowPolicy`

| Group | Fields (examples) | Meaning |
|---|---|---|
| **Context pie** | `maximumOutputTokens`, `usableInputTokens`, `sections.*`, `compaction`, `carry`, `injection`, `fragments` | How to **fill** the prompt |
| **Work hints** | `mutation.*`, `planning.*`, `run.max*` / `run.hardMax*` | Suggested batch sizes / call caps |

**Context pie** = this module’s main product.  
**Work hints** = suggested numbers for whoever runs the loop (engine rewrite). Enforcement is **not** here.

### Tiny example (`W = 100_000`)

```text
O  ≈ output reserve
T  ≈ tool-schema cost
U  = W − O − T          ← usable input

U split → repo | conversation | plan | skills | system
run     → soft model calls + hard model calls (hints only)
```

---

## Public API

Prefer:

```ts
new WindowBudgetPipeline({ log }).derive(input)
```

Aliases kept for hosts: `deriveWindowPolicy`, `resolveGenerationCeiling`.

---

## Owns / does not own

**Owns:** proportional token allocation, band/effort/mode tables, soft/hard *hint* values on `run`, stage logging.

**Does not own:** model/tool loop, Continue walls, `budget_exhausted`, discovery budgets, grants, prompts.

---

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/window-budget
```

---

## Bands (context size)

| Band | Window | Effect |
|---|---|---|
| compact | &lt; 50k | tighter output/plan shares |
| standard | 50k – &lt; 100k | defaults |
| wide | ≥ 100k | more repo/plan room |

Effort (`low` / `medium` / `high`) scales mutation and **run hint** ceilings on top of the band.

Merge order for policy tables: `defaults → band → model profile → mode → host overrides` → then effort on the derived allocation.

Full field list and formulas live in `contracts/output/WindowPolicy.ts` and `actions/2-derive-allocation.ts`.

---

# Refactor brief (module 1)

## What changed

- Folded scattered budget logic into one readable layout: `pipeline/` + numbered `actions/` + `policy/` + `contracts/` + `tests/`.
- Added `WindowBudgetPipeline` as the canonical facade (`derive`, ceilings, tool-loop caps).
- Moved band / effort / mode / model-profile / tool-loop-cap / merge tables under `policy/`.
- Put **real step functions** in `actions/` (not re-export shelves).
- Centralized reason codes and stage names in `constants.ts` (`WINDOW_BUDGET_REASON`, `WINDOW_BUDGET_EFFORT_REASON`, `WINDOW_BUDGET_MODE_REASON`, `WINDOW_BUDGET_STAGES`).
- Added optional `ModuleLoggerPort` + optional `WindowPolicy.stages` traces.
- Published soft + hard run **hints** on `WindowPolicy.run` (`max*` soft, `hardMax*` hard).

## Why it changed

- The old layout made “where does the number come from?” hard to answer.
- Magic reason-code strings were easy to typo and hard to grep.
- Soft vs hard run caps were unclear; unlimited was getting treated like a soft ceiling in the engine.
- Module cleanup must stay readable **before** the engine rewrite consumes these contracts.

## How we refactored it

1. Locked public contracts (`WindowBudgetInput` → `WindowPolicy`).
2. Extracted policy **tables** into `policy/` (no orchestration there).
3. Numbered flow steps as real functions in `actions/`.
4. Made `WindowBudgetPipeline.derive()` the only orchestrator that calls 1 → 2 (and exposes 3 as a helper).
5. Kept thin free-function aliases so existing hosts keep compiling during the engine rewrite.
6. Added golden + unit + contract tests; verified with vitest.

## How constants / reason texts were moved

| Before | After |
|---|---|
| Inline `"effort_medium"`-style strings / templates | `WINDOW_BUDGET_REASON.*`, `WINDOW_BUDGET_EFFORT_REASON[effort]`, `WINDOW_BUDGET_MODE_REASON[mode]` |
| Ad-hoc stage labels | `WINDOW_BUDGET_STAGES.resolvePolicy` etc. |
| Error code literals | `WINDOW_BUDGET_ERROR_CODES` / `WindowBudgetError` |

Rule going forward: **never** build reason codes with string templates. Add a named constant, then use it in derive + tests + logs.

## How logger helps identify problems

Inject `log: ModuleLoggerPort` into `WindowBudgetPipeline`:

```ts
new WindowBudgetPipeline({
  log: {
    stage(event) {
      // event.module === "window-budget"
      // event.stage === "1-resolve-policy" | "2-derive-allocation"
      // event.reasonCodes, inputSummary, outputSummary, durationMs
    },
  },
}).derive(input)
```

Use logs to answer:

| Symptom | Look at |
|---|---|
| Wrong band / profile | `1-resolve-policy` `outputSummary.band` / `modelProfileId` |
| Pie doesn’t add up / usable too small | `2-derive-allocation` `reasonCodes` + `usableInputTokens` / `maximumOutputTokens` |
| Effort/mode overlay missing | presence of `effort_*` / `mode_*` in `reasonCodes` |
| Slow derive | `durationMs` per stage |

`WindowPolicy.stages` (when using the pipeline) is the same ordered trail without a live logger.

## How to extend the module

| Goal | Where |
|---|---|
| New context-size band | `policy/bands.ts` + golden |
| New effort scaling | `policy/effort.ts` (+ map in `constants` if new reason) |
| New mode overlay | `policy/mode.ts` |
| New model family defaults | `policy/modelProfiles.ts` |
| New pie section / formula | `actions/2-derive-allocation.ts` + `WindowPolicy` schema |
| New public entry | method on `WindowBudgetPipeline` (don’t invent a second orchestrator) |
| New stable string | `constants.ts` first |

Keep `policy/` data-only. Keep orchestration in `pipeline/`.

## If something breaks later — how to fix

1. Reproduce with the smallest input (`contextWindowTokens`, `mode`, `effort`, `modelId`).
2. Read `reasonCodes` / logger stages — find which step diverged.
3. Fix at the **owner**: table bug → `policy/`; formula bug → `actions/2-…`; API shape → `contracts/`.
4. Add a regression (unit or golden). Do **not** special-case one host path in core.
5. Re-run `pnpm exec vitest run packages/v8/src/modules/window-budget`.

## Bugs fixed while redesigning

| Bug | Fix |
|---|---|
| Unlimited run budget clamped to soft (e.g. 64) | Soft vs hard fields on `WindowPolicy.run`; clamp respects hard for unlimited |
| Soft exhaust treated like hard stop | Soft → Continue checkpoint; hard → `budget_exhausted` (engine; numbers owned here) |
| Continue only nudged soft by a tiny bump | Continue extends soft by a full soft chunk toward hard |
| Reason codes built/ad-hoc | Named maps in `constants.ts` |

## Room left for improvement

- Engine still calls free `deriveWindowPolicy` in places — switch fully to `WindowBudgetPipeline` + inject logger.
- Collapse any remaining “lab” path string assumptions once ui-core/scripts settle.
- Optional: richer `inputSummary` (tool-schema source) without logging secrets.
- Keep goldens as the lock on band math when tables change.

## Verification

`pnpm exec vitest run packages/v8/src/modules/window-budget` → 8 files / 38 tests passed.
