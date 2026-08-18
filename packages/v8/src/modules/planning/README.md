# Planning

Planning creates structured plans when policy or user mode calls for visible planning. It turns task evidence into a `PlanArtifact` with phases, steps, context references, risks, alternatives, and verification guidance.

## What This Module Does

- Validates `PlanningInput`.
- Blocks planning when `planningDepth` is `none`.
- Resolves plan strategy with a deterministic rule table: `follow_evidence`, `discover_and_plan`, `plan_from_ask`, or `clarify` — no strategy LLM call, ever. A host/test-supplied `strategyOverride` always wins (sanitized).
- Compiles a generic `DiscoveryBrief` from read-only observations when the engine ran a discovery pass.
- Drafts a generic structured plan from task dimensions and optional discovery evidence.
- Uses in-scope preflight build diagnostics for repair plans without letting unrelated errors redefine the user ask.
- For `discover_and_plan` only: one model call turns already-gathered discovery evidence into Change+Verify steps (never a second Discover phase — discovery already ran). Falls back to the deterministic discovery skeleton if that call fails or returns nothing usable.
- Incorporates optional skill hints, process hints, reviewed context, and prior plans.
- Validates required plan sections, including stripping a stray Discover/Inspect/Explore phase if a `discoveryBrief` is present (discovery already ran; a model-drafted plan must not repeat it).
- Compacts the plan to a token budget.
- Serializes plan artifacts for user answers or prompt injection, including a strategy-aware execution contract.

## Structure

```text
planning/
  pipeline/                 PlanningPipeline
  actions/                  Resolve strategy (rules), draft, draft-from-discovery, apply-discovered-draft, validate, compact, serialize, format
  internal/                 Discovered-plan prompt and evidence scoping
  contracts/
    input/                  PlanningInput, DiscoveryBrief
    output/                 PlanArtifact, PlanStrategyDecision, DiscoveredPlanDraft, PlanningResult
    ports/                  PlanningLlmPort
    errors/                 PlanningErrors
  tests/
```

## Types And Contracts

- `PlanningInput`: query, mode, route, planning depth, `explorationDepth` (how hard to look — orthogonal to `planningDepth`, which is whether a visible plan exists), task evidence, optional scoped repo map, build evidence, optional `DiscoveryBrief`, skills, process hints, reviewed context, prior plan, optional strategy override, and budget.
- `DiscoveryBrief`: host-neutral discovery evidence (files read, targets, change surfaces, constraints, verification hints, open questions, confidence). It does not carry mutable task status.
- `PlanningTaskEvidence`: primary/secondary intent, scope, complexity, risk, clarity, targets, constraints, outcomes, recommendations, and change impact hints.
- `PlanStrategyDecision`: the selected planning mode plus `skipDiscover` and `useBuildEvidence`.
- `DiscoveredPlanDraft`: the `discover_and_plan` model call's output — objective/open-questions/Change+Verify step wording, applied onto the deterministic discovery skeleton.
- `PlanArtifact`: structured plan with dimensions, phases, steps, risks, alternatives, and verification.
- `PlanningResult`: status, optional plan, optional strategy, warnings, reason codes, used budget, total budget, and duration.

## Technical Details

- The public facade methods are async `PlanningPipeline.plan` and `PlanningPipeline.resolveStrategy` (test/host helper — normal runs let Engine call `resolvePlanStrategyRules` directly before deciding whether to run discovery), plus `compileDiscovery`.
- Strategy rule table (`resolvePlanStrategyRules`, always resolves — no LLM, no fallback branch):
  1. clarity `unclear`/`ambiguous` -> `clarify`
  2. repair intent plus in-scope diagnostics -> `follow_evidence`
  3. repair + broad "fix all …" / package-wide verification ask -> `follow_evidence` (do not rediscover)
  4. `explorationDepth === "quick"` -> `plan_from_ask`
  5. Deep/Auto and wide scope/complexity (or `recommendsPlanning`, itself folded from understanding's `recommendsPlanning` OR `recommendsRepositoryDiscovery`) -> `discover_and_plan`
  6. else -> `plan_from_ask`
- Repair detection uses a single shared predicate (`decision-policy`'s `isRepairIntentTaxonomy`), not words like `error` in the user sentence. The same predicate backs Decision Policy's preflight-capture gate and `DraftPlan`'s Discover/Change step wording, so all three cannot drift out of sync.
- Engine owns strategy selection — it calls `resolvePlanStrategyRules` itself (not a port method) before deciding whether to run a discovery pass, then calls `planning.plan({ strategyOverride })`. Planning never runs a second classifier.
- `follow_evidence` and `plan_from_ask` skip discovery entirely (`skipDiscover: true`). `discover_and_plan` runs Engine's bounded read-only discovery loop first; Planning then receives `discoveryBrief` and `skipDiscover: true` and either runs its one model call (see below) or falls back to the deterministic discovery skeleton.
- Planning works without an injected LLM. Rules and deterministic drafting still return a plan; the `discover_and_plan` model call is skipped (not required) when no LLM is configured.
- There is no generic enrichment layer. The only model call after strategy resolution is `discover_and_plan`'s one-shot draft (`draftPlanFromDiscovery` + `applyDiscoveredPlanDraft`), and it runs at most once per plan, scoped to Change+Verify steps only. It cannot alter approval requirements, plan dimensions, gates, or tool grants. Target refs are filtered against the scoped repo map, discovery evidence, **in-scope** diagnostics, and explicit targets.
- `serializePlanForPrompt` emits a strategy-aware execution contract. For `discover_and_plan` it explicitly says discovery already ran — do not rediscover, start at the first Change step. Engine persists `planStrategy` on the run result and plan-approval checkpoint so resume/host-carry does not fall back to "start at Discover".
- Hosts SHOULD persist `planStrategy` with a pending plan and pass it back as `approvedPlanStrategy`. `inferPlanStrategyFromArtifact` is the conservative fallback when that decision is missing.
- Skill hints are optional and must not become hard-coded plan switches.
- `priorPlan` supports validation or revision.
- `formatPlanAsAnswer`, `serializePlanForPrompt`, and `serializePlanText` produce safe text from structured plans.

## Public Exports

- `PlanningPipeline`
- `planningInputSchema`, `planningResultSchema`, `planArtifactSchema`, `planStrategyDecisionSchema`, `discoveryBriefSchema`, `explorationDepthSchema`
- `resolvePlanStrategyRules`, `isRepairIntent`
- `compileDiscoveryBrief`, `inferPlanStrategyFromArtifact`, `serializePlanForPrompt`, `serializePlanText`, `formatPlanAsAnswer`
- `PlanningError` and planning reason/error codes

## Failure Modes

- `planningDepth: none` returns `blocked` with `plan_depth_none`.
- Invalid input throws `PlanningError` (`invalid_input`).
- Invalid required sections return `blocked` with `plan_blocked_invalid`.
- `discover_and_plan`'s model draft call failing keeps the deterministic discovery skeleton (`plan_discovery_draft_failed_fallback`).
- Out-of-scope diagnostics are ignored (`plan_build_evidence_out_of_scope`).
- Low-confidence discovery keeps open questions and does not invent file-scoped tasks (`plan_discovery_insufficient`).

## Genericness Strategy

Strategy, drafting, and diagnostic scoping use intent taxonomy, explicit targets, and a scoped repo map. They do not hard-code a language, package manager, workspace layout, or host.

## Ownership Boundaries

Owns structured plan creation and serialization. Strategy *rules* live here so they're unit-testable in isolation, but Engine is the caller that decides when to invoke them and whether to run discovery first — Planning does not own that orchestration.

Does not own plan approval UI, tool execution, route authority, task-list persistence, or verification execution. Hosts own pending-plan storage and must carry `planStrategy` with the artifact.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/planning
```

Related engine coverage checks async planning, task-list alignment, discovery, and the repair-queue behavior:

```bash
pnpm exec vitest run packages/v8/src/engine/agent-engine/tests/AgentEngineTaskList.spec.ts packages/v8/src/engine/agent-engine/tests/AgentEnginePipeline.spec.ts packages/v8/src/engine/agent-engine/tests/AgentEngineDiscovery.spec.ts packages/v8/src/engine/agent-engine/tests/AgentEngineRepairQueue.spec.ts
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
@packages/mui-builder fix all the ts errors
```

### Real Input Structure

PlanningInput -> PlanningResult. Engine supplies understanding evidence, optional scoped repo map, and preflight build evidence:

```json
{
  "schemaVersion": 1,
  "query": "@packages/mui-builder fix all the ts errors",
  "mode": "plan",
  "route": "plan",
  "planningDepth": "visible",
  "explorationDepth": "auto",
  "evidence": {
    "primaryIntent": "bugfix",
    "scope": "package",
    "complexity": "moderate",
    "risk": "low",
    "clarity": "clear",
    "targets": [{ "kind": "folder", "value": "packages/mui-builder", "explicit": true }],
    "requestedOutcomes": ["Fix all TypeScript errors"],
    "recommendsPlanning": true,
    "recommendsVerification": true,
    "changeImpact": ["code"]
  },
  "scopedRepoMap": {
    "entries": [{ "path": "packages/mui-builder/src/Button.tsx", "kind": "file" }]
  },
  "buildEvidence": {
    "phase": "before",
    "summary": "1 error(s); failed checks: typecheck",
    "failedChecks": ["typecheck"],
    "diagnostics": [
      {
        "path": "packages/mui-builder/src/Button.tsx",
        "severity": "error",
        "message": "Type 'number' is not assignable to type 'string'.",
        "startLine": 42,
        "code": "TS2322"
      }
    ]
  }
}
```

### Step-By-Step Flow

1. The engine captures a preflight build snapshot, then calls `resolvePlanStrategyRules` itself.
2. Repair intent plus in-scope diagnostics resolve to `follow_evidence` — no discovery pass runs.
3. Drafting emits Change/Verify steps for the in-scope diagnostic, not a Discover mega-plan.
4. Validate and compact run as usual.
5. The result includes `strategy` so the engine, resume checkpoint, and host can keep the same execution contract.

### Realistic Output

```json
{
  "schemaVersion": 1,
  "status": "validated",
  "plan": {
    "schemaVersion": 1,
    "objective": "Fix all TypeScript errors",
    "phases": [
      {
        "id": "phase-change",
        "name": "Change",
        "steps": [
          {
            "id": "step-fix-diagnostic-1",
            "intent": "Fix TS2322 in packages/mui-builder/src/Button.tsx",
            "targetRefs": ["packages/mui-builder/src/Button.tsx"]
          }
        ]
      },
      { "id": "phase-verify", "name": "Verify", "steps": [{ "id": "step-verify", "intent": "Re-run typecheck" }] }
    ]
  },
  "strategy": {
    "schemaVersion": 1,
    "strategy": "follow_evidence",
    "rationale": "In-scope preflight diagnostics match a repair ask.",
    "skipDiscover": true,
    "useBuildEvidence": true
  },
  "reasonCodes": ["plan_drafted", "plan_strategy_follow_evidence", "plan_strategy_rules", "plan_diagnostics_considered"],
  "usedTokens": 420,
  "budgetTokens": 1600
}
```
