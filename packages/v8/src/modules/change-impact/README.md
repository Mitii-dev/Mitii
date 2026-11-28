# Change Impact

A ripple map: if you touch this file or symbol, what else is likely to be affected?

## Does
- Walks a published `RepoGraph` from a file / symbol / caret seed, over dependents or dependencies.
- Estimates blast radius, risk tier, and confidence, with hop / node / path limits.
- Boosts results with historical coupling and reports cycles.
- Also supports multi-seed analysis and merge, plan-check (counterfactual paths), spillover (package set diff), and widen recommendations.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `ChangeImpactInput` (`seed`, `direction`, `repoGraph`, `maximumHops`, `maximumAffectedNodes`, optional `historicalCoupling` / `includePackages`).
**Output:** `ChangeImpactResult` (`status` ok | partial | empty, affected nodes/files, `blastRadius`, `reasonCodes`, `confidence`).
**Pipeline:** `ChangeImpactPipeline` stages: `1-assess-graph` → `2-resolve-seeds` → `3-walk-impact` → `4-apply-coupling-cycles` → `5-finalize-result`; extra actions (`6-analyze-many`, `7-merge-results`, `8-evaluate-spillover`, `9-plan-check`, `10-merge-navigation-enrichment`, `11-compact-model-facing`, `12-recommend-widen`) run on top of the result.
**Ports we offer / need:** offers `RepositoryGraphPort` (read access to published graphs, used by callers such as planning); the pipeline itself receives the graph in its input. Optional `ModuleLoggerPort`.

## Dependencies
**Upstream (this module uses):** repository-state (graph and state types).
**Downstream (who uses this):** planning, and the engine and tool-runtime (change-impact and plan-check tools, result serialization).

## How to use
```ts
import { ChangeImpactPipeline } from "@mitii/v8/modules/change-impact";

const result = new ChangeImpactPipeline().analyze(input);
```

## Example
Input (abbreviated; `repoGraph` omitted):
```json
{
  "schemaVersion": 1,
  "seed": { "kind": "file", "relativePath": "src/LoginForm.tsx" },
  "direction": "dependents",
  "maximumHops": 3,
  "maximumAffectedNodes": 80
}
```
Output (illustrative, abbreviated):
```json
{ "status": "ok", "blastRadius": { "level": "medium", "riskTier": "moderate" }, "reasonCodes": ["impact_resolved"] }
```

## Non-responsibilities
Does not build the graph, run verification, or change the working tree.
