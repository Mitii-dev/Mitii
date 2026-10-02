# V8 Engine

Thin run orchestrator — **sole** Mitii engine (Phase 10; `agent-engine/` deleted).

**Plan:** [`project-goals/v8-engine-rewrite-plan.md`](../../../../project-goals/v8-engine-rewrite-plan.md) · **Ownership (Phases 7–10):** [`project-goals/v8-engine-ownership-plan.md`](../../../../project-goals/v8-engine-ownership-plan.md) · **Promotion:** [`PROMOTION.md`](./PROMOTION.md)

## Status

| Piece | Status |
|-------|--------|
| Thin loop + discipline | done |
| Host opt-in / compose switch | done |
| Default implementation | **`v8`** only (`legacy` setting maps to v8) |
| Always-on goldens (§7.2) | done |
| Curated-40 catalog | done |
| Nightly eval workflow | done |
| Shaped discovery profiles | done (incl. monorepo / security / testing) |
| Mutation critic | done (`steering.criticMode`) |
| Progressive INDEX stubs | done (`filterToolDefinitions`) |
| Policy lab v8 knobs | done (`pnpm policy-admin` + `v8LoopPolicy`) |
| **Phase 7.1** prepareTurn (compaction / working set) | done |
| **Phase 7.2** rejected-mutation soft recovery | done |
| **Phase 7.3** soft must-read nudge budget | done |
| **Phase 7.4** honest truncation vs reasoning | done |
| **Phase 7.5** Dropped-legacy kill list + PROMOTION | done |
| **Phase 8.1** EventBus / RunBudget / caches / checkpoint | done (owned in `v8-engine/internal/`) |
| **Phase 8.2** discoveryPass split + shapedDiscovery | done (`internal/discovery/`) |
| **Phase 8.3** executeTool + support (split ≤600) | done (`executeTool` / `Finish` / `Support`) |
| **Phase 8.4** verification finish/gate/repair (split ≤600) | done (`Gate` / `Artifacts` / `Finish*` / `BudgetWall`) |
| **Phase 8.5** earlyPipeline + pinAndDiscovery | done (`executeStartEarlyPipeline` / `pinState` / `pinDiscovery*`) |
| **Phase 8.6** enrichment (skills/memory/plan) | done (`executeStartEnrichment` + `Tail`) |
| **Phase 8.7** resume (clarify/plan/grant/continue/approval) | done (`executeResume` + `Handlers`) |
| **Phase 8.8** checkpoint adapters + restore | done (`File`/`InMemory` stores + restore pipeline) |
| **Phase 8** ownership cut of runtime/verify/tools/start/resume | **complete** |
| **Phase 9.1** OWN actions → `modules/<job>/` | done |
| **Phase 9.2** BRIDGE maps → prompt/skills/planning | done |
| **Phase 9.3–9.4** diagnose answer + plan discovery (G8/G9) | done |
| **Phase 9.5** review port stub | done (`createReviewPort`) |
| **Phase 9.6** curated-40 pass bar docs | done (`tests/eval/PASS_BAR.md`) |
| **Phase 9** module polish + bridges | **complete** |
| **Phase 10** delete `agent-engine` | **complete** (tree gone; compat exports via `legacy/`) |

## Usage

```ts
import { composeAgentEngine, createMitiiClient } from "@mitii/sdk";

// Sole orchestrator after Phase 10:
createMitiiClient({ understandingLlm, runLlm });

// `legacy` still parses but resolves to v8:
createMitiiClient({
  understandingLlm,
  runLlm,
  engineImplementation: "legacy",
});
```

**Setting:** `mitii.engine.implementation` = `v8` | `legacy` (both run **v8**; `legacy` is a compatibility alias).  

**V8 knobs:** ship bands in `policy/bands.ts` (edit via `pnpm policy-admin`). Local Custom: `mitii.v8LoopPolicy.*`.

**Mutation critic:** `steering: { criticMode: "off" | "shadow" | "enforce" }` (default off).
**Verification LLM critique:** `steering: { verificationLlmCritique: true }` (default off).
Advisory only after the evidence gate — never overrides `decideVerificationGate`.

## Medium close-loop (P1)

When Officer `taskSize=medium`:

```text
preferred medium-planning (soft)
  → discover_and_plan (known paths still discover)
  → bounded seed-first discovery (taskSize × window band)
  → concrete Change steps → non-empty plan-derived task list
  → per-step bind (not a second discovery) → READY → patch
```

**Budgets (two envelopes, one philosophy):**
- **Discovery (pre-plan):** model/tool-loop turns × file reads by size×band (Medium standard: 4 turns / 8 paths). Free pre-seed discovery stays 2; post-READY discovery stays 0.
- **Per-step bind (post-plan):** Medium compact/standard 3 turns / 8 paths / 2 nudges; wide 2 / 8 / 2.

**Failure ladder:** sufficient → plan; local gap → one seed-informed targetRefs recovery; still empty → `task_list_plan_not_concrete` (clarify/suspend — never invent an executable row from seed alone); scope blown → escalate (not +5 forever).

## Eval

- Always-on: `pnpm --filter @mitii/v8 run test:v8-engine`
- Nightly: `pnpm --filter @mitii/v8 run eval:nightly`
- Catalog: `tests/eval/curated-40.json`
- Pass bar: [`tests/eval/PASS_BAR.md`](./tests/eval/PASS_BAR.md)

## Rules

See ownership plan §1 / rewrite plan §2.1 (no peer names in source; ≤600 lines/file; proper constants/contracts).
