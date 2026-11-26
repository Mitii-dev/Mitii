# Plan discovery (runtime)

Bounded readonly discovery before PlanningPipeline (S3A-DISCOVER).

## Owns
- Whether/how to run a discovery pass (`shouldRunDiscoveryPass`, `runDiscoveryPass`)
- Quality floor + sufficiency (`EnforceDiscoveryQualityFloor`, `PlanDiscoveryQuality`)
- Discovery strategy contract (`applyPlanModeDiscoveryContract`)
- Scope-phase bounds / clarify draft / next-phase answer formatting
- Planning follow-up detection + path utils
- Planning query / path hints / preferred seed paths (`PlanningQuery`, `PlanningPathHints`)
- Discovery seed-path hygiene (`DiscoverySeedPaths`)
- Readonly discovery grant surface

## Does not own
- Discovery budgets (→ `modules/window-budget`)
- Shaped profile registry (→ `runtime/helpers/shaped-discovery`)
- Plan strategy / clarify draft content builders (→ `modules/planning`)
- Scope-fork suspend (→ `runtime/helpers/gates`)

## Engine
`engine/v8-engine/modules/plan-discovery/*` is thin re-exports of this folder +
window-budget.
