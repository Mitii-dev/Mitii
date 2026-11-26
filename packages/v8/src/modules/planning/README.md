# Planning

The planner: it turns evidence into a clear, step-by-step `PlanArtifact` when a plan is needed.

## Does
- Validates input and blocks when planning depth is `none`.
- Picks a strategy with fixed rules (`follow_evidence`, `discover_and_plan`, `plan_from_ask`, `clarify`) — no strategy LLM.
- Drafts a deterministic skeleton from evidence, discovery brief, and skills.
- Optionally uses one LLM call to draft Change + Verify steps, or to write clarify options (with a deterministic fallback).
- Checks concreteness, applies working sets, and compacts the plan to budget.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `PlanningInput` (query, mode, route, depths, evidence, optional discovery / build / impact reports, skills, budget, optional `strategyOverride`).
**Output:** `PlanningResult` (`status` validated | compacted | blocked, optional `plan`, strategy, optional `clarifyDraft`, warnings, reason codes, tokens, duration).
**Pipeline:** `PlanningPipeline` stages: `1-resolve-strategy` → `2-draft-skeleton` → `3-apply-discovery-draft` → `4-enforce-discovery-quality` → `5-draft-clarify` → `6-validate-plan` → `7-apply-working-sets` → `8-compact-plan` → `9-finalize-result`
**Ports we offer / need:** optional `PlanningLlmPort` (same shape as `LlmPort`) for discovery and clarify drafts; optional `ModuleLoggerPort`. Adapters under the LLM kind fulfill the port.

## Dependencies
**Upstream (this module uses):** change-impact, decision-policy, model-gateway, repository-state, request-intake, request-understanding, verification.
**Downstream (who uses this):** task-list (plan → checklist) and the engine (plan discovery, start pipeline, composition).

## How to use
```ts
import { PlanningPipeline } from "@mitii/v8/modules/planning";

const planning = new PlanningPipeline({ llm }); // llm is optional
const result = await planning.plan(input);
```

## Example
Input (illustrative, abbreviated):
```json
{ "query": "Add loading state to LoginForm", "mode": "plan", "route": "build", "planningDepth": "standard" }
```
Output (illustrative, abbreviated):
```json
{ "status": "validated", "strategy": "discover_and_plan", "plan": { "steps": [{ "kind": "change", "title": "Update src/LoginForm.tsx" }, { "kind": "verify" }] } }
```

## Non-responsibilities
Does not run tools, own run state, approve plans, or decide when discovery runs — the engine owns that orchestration.
