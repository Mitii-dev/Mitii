# Planning

Builds a structured `PlanArtifact` when policy or user mode needs a visible (or internal) plan. Strategy is rule-only; the optional LLM drafts Change+Verify steps from discovery evidence or clarify forks.

## Does

- Validate `PlanningInput`; block when `planningDepth` is `none`.
- Resolve strategy via deterministic rules (`follow_evidence` | `discover_and_plan` | `plan_from_ask` | `clarify`) — no strategy LLM.
- Draft a deterministic skeleton from task evidence / discovery brief / skills.
- For `discover_and_plan` with a non-thin brief: one LLM call (`adapters/llm`) to draft Change+Verify steps onto the skeleton.
- For scope-fork clarify: one LLM call for findings + A/B/C (deterministic fallback if no LLM / failure).
- Validate concreteness, apply hop-1 working sets, compact to budget.

## Contract

**In:** `PlanningInput` (query, mode, route, depths, evidence, optional discovery/build/impact, skills, budget, optional `strategyOverride`).

**Out:** `PlanningResult` (status, optional plan, strategy, optional `clarifyDraft`, warnings, reason codes, tokens, duration).

**Ports:** `PlanningLlmPort` (optional model for discovery/clarify drafts); optional `ModuleLoggerPort`.

**Stages:** `1-resolve-strategy` → `2-draft-skeleton` → `3-apply-discovery-draft` → `4-enforce-discovery-quality` → `5-draft-clarify` → `6-validate-plan` → `7-apply-working-sets` → `8-compact-plan` → `9-finalize-result`.

## Example

```ts
import { PlanningPipeline } from "@mitii/v8/modules/planning";

const planning = new PlanningPipeline({ llm }); // llm optional
const result = await planning.plan(input);
// result.status: validated | compacted | blocked
// result.plan?: PlanArtifact
```

## Non-responsibilities

Does not execute tools, own run state, approve plans, or choose when discovery runs — Engine owns that orchestration.
