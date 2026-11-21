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

### Provider infrastructure

After gateway bounded retries, `provider_unavailable` / `fetch failed` suspends
as Continuable `provider_unavailable` — not a bare agent-logic fail. Index
rehydrate fingerprint pins reuse the persisted full-index snapshot id so
map/graph stay bound.

## Eval

```bash
pnpm --filter @mitii/v8 run test:v8-engine
pnpm --filter @mitii/v8 run eval:nightly
```

- Catalog: `tests/eval/curated-40.json`
- Pass bar: [`tests/eval/PASS_BAR.md`](./tests/eval/PASS_BAR.md)

## Rules

Contract-first modules, ≤600 lines/file, no peer product names in source,
public `index.ts` only. See `packages/v8/ARCHITECTURE.md` and the repo Cursor rule.
