# V8 Engine

Mitii’s run orchestrator. Hosts start and resume agent runs through
`@mitii/sdk`; this package owns the loop: understand → decide → discover →
plan → tools → verify → finish.

**Promotion / defaults:** [`PROMOTION.md`](./PROMOTION.md)

## Usage

```ts
import { createMitiiClient } from "@mitii/sdk";

createMitiiClient({ understandingLlm, runLlm });

// `legacy` still parses but always resolves to v8:
createMitiiClient({
  understandingLlm,
  runLlm,
  engineImplementation: "legacy",
});
```

| Setting / env | Values | Notes |
|---|---|---|
| `mitii.engine.implementation` | `v8` \| `legacy` | Both run **v8**; `legacy` is a compatibility alias |
| `MITII_ENGINE_IMPLEMENTATION` | same | Same alias behavior |

**Loop knobs:** ship bands in `policy/bands.ts` (edit via `pnpm policy-admin`).
Local Custom: `mitii.v8LoopPolicy.*`.

**Mutation critic:** `steering: { criticMode: "off" | "shadow" | "enforce" }`
(default off). When enforce/shadow and understanding has explicit file/folder
targets, a batch that touches none of them revises (wrong-target) without
widening the grant.

**Verification LLM critique:** `steering: { verificationLlmCritique: true }`
(default off). Advisory only after the evidence gate — never overrides
`decideVerificationGate`.

## What the loop owns

```text
start / resume
  → early pipeline (pin + discovery)
  → enrichment (skills / memory / plan)
  → model + tool loop
  → verification finish / gate / repair
  → checkpoint adapters
```

Owned helpers live under `pipeline/`, `internal/`, and `modules/<job>/`.
Compat exports for older host surfaces live under `legacy/` — there is no
second orchestrator tree.

## Medium close-loop + evidence valve

When Officer `taskSize=medium`:

```text
preferred medium-planning (soft)
  → discover_and_plan (known paths still discover)
  → bounded seed-first discovery (taskSize × window band)
  → concrete Change steps → non-empty plan-derived task list
  → per-step bind (happy-path budget) → READY → patch
```

- **Size → happy-path budget** (token bands are candidates only; pinned folder
  is work root, not size).
- **Evidence sufficiency → recovery valve** when that budget is not enough:
  local named miss → one capped recovery → gate again; otherwise
  clarify/escalate. Never “budget exhausted → +10 searches → patch whatever.”

**Small clear UI asks:** package scope from a folder pin alone does **not** fire
`broad_repair_visible_plan` / change-impact. Short `change/rename … to …`
nav/label asks execute (no false clarify).

**Budgets (two envelopes):**

- **Discovery (pre-plan):** model/tool-loop turns × file reads by size×band
  (Medium standard: 4 turns / 8 paths).
- **Per-step bind (post-plan):** Medium compact 5/10/4 · standard 4/8/3 ·
  wide 3/8/3 (turns / paths / nudges), plus recovery 2/4.

**Always short plan:** Agent execute never uses `planningDepth: none` — small
asks get an internal short plan with evidence.

### Plan thoroughness (Ask → Plan follow-up)

`modules/plan-discovery` owns the contract:

1. Multi-item “plan the above” follow-ups bump `taskSize` ≥ medium.
2. Thorough discovery needs productive multi-file evidence.
3. Discovery failure fail-closes to clarify.
4. Hollow single-surface skeletons for medium+/multi-item asks are rejected.
5. A/B/C scope-fork suspend only when the ask truly forks.

Goldens: always-on **G10**, behavioral `plan thorough Ask→Plan follow-up`.
Details: `modules/plan-discovery/README.md`.

### Verification honesty

- Hard-deny mutations: `node_modules`, `.git`, `dist`, `build`, `out`.
- Ask-scoped accept when in-scope diagnostics are clean even if workspace-root
  checks still fail on pre-existing noise.
- Compare-only leftovers: remaining pre-existing diagnostics are optional for
  the user (“fix remaining?”), not forced unbounded repair.
- Failure ladder: sufficient → plan; local gap → one recovery; still empty →
  clarify; bind miss → one evidence recovery then **hard STOP**
  (`evidence_recovery_exhausted_terminal`).

### Stability guards

- **Result contract:** `RunEvidence` is clamped to schema limits at the producer
  (`clampRunEvidence`). The final result goes through
  `parseAgentRunResultResilient`: a schema failure in an optional section clamps
  or drops that section, adds `result_contract_degraded`, and keeps the run
  outcome. Failures on core fields (status, usage, reason codes, …) still throw.
- **Verified finish:** a passing verification command after the last edit, with
  no open task-list items, ends the loop
  (`loop_finished_after_verified_mutation`); the verification gate then decides.
  No extra free-form narration turn.
- **Plan approval resume:** the checkpoint carries `understanding`; resume reuses
  it with the pinned state, decision, and execution seed (`resume_state_reused`)
  instead of re-running pin/preflight/understand/decide. Legacy checkpoints fall
  back to full startup. `approvalMode: never` implies `planApproval: never`
  unless the host sets `planApproval` explicitly.

### Provider infrastructure

After gateway bounded retries, `provider_unavailable` / `fetch failed` suspends
as Continuable `provider_unavailable` — not a bare agent-logic fail. Index
rehydrate fingerprint pins reuse the persisted full-index snapshot id so
map/graph stay bound.

### Accuracy controls

- **Fast path:** `fast_path_plan_skipped` — small asks with explicit paths skip the visible plan.
- **Wall time:** `maxWallTimeMs` (SDK/CLI `--timeout`) feeds `RunBudgetTracker`. Near the deadline the loop prefers finalize after a verified mutation (`wall_time_finalize_after_mutation`), otherwise one `wall_time_wrap_up_nudge`, and no new model turn starts from the verification-repair loop.
- **Behavior gate:** `decideVerificationGate` rejects `implemented_unverified` when a behavior test defect exists and treats it as a repairable target.
- **Seed hygiene:** `resolveDiscoverySeedPaths` drops prose tokens and unresolved basenames/globs before `read_file` (`discovery_seed_paths_filtered`); user-named paths are never dropped as merely unindexed.
- **Create asks:** `agent_create_ask_execute` routes to execute, and the `no_mutation_performed` gate stops a plan-only reply from completing.

## Eval

```bash
pnpm --filter @mitii/v8 run test:v8-engine
pnpm --filter @mitii/v8 run eval:nightly
```

- Catalog: `tests/eval/curated-40.json`
- Live (opt-in): `pnpm --filter @mitii/v8 run eval:live` (`MITII_LIVE_EVAL=1`; needs built CLI + provider env). Default runs validate the catalog and grading helpers only.
- Pass bar: [`tests/eval/PASS_BAR.md`](./tests/eval/PASS_BAR.md)

## Rules

Contract-first modules, ≤600 lines/file, no peer product names in source,
public `index.ts` only. See `packages/v8/ARCHITECTURE.md` and the repo Cursor rule.

## Structure debt (tracked)

Enforced by `tests/architecture/` (`pnpm run check:architecture`):

- Legacy re-export shims in `actions/` were removed; engine code imports owners'
  public `index.ts` directly.
- `actions/` still holds engine-local helpers alongside `modules/`. Move each
  helper to the module that owns its outcome when it next changes.
- `pipeline/modelLoop.ts` is still over 600 lines (allowlisted). Types live in
  `modelLoopTypes.ts` and pure helpers in `modelLoopSupport.ts`; the loop closure
  needs a shared state object before it can be split further.
- File-level import cycles inside this component remain; unit-level cycles are
  forbidden and baselined empty (`baselines/module-cycle-baseline.json`).
