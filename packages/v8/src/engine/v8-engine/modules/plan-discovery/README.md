# Plan discovery

Engine-owned contract for Plan (and Agent big-task) discovery before Planning drafts a visible plan.

## Responsibility

- Force `discover_and_plan` for cold / shaped Plan asks and Agent medium+/visible tasks.
- Size the bounded discovery envelope (`taskSize` × window band).
- Enforce the Plan quality floor after the discovery pass (fail closed → clarify).
- Prefer real exploration over known-path short-circuits for thorough Plan asks.

## Plan thorough contract

| Gate | Rule |
|------|------|
| Quality floor | Plan (not `quick`) always; Agent medium/large or visible/wide-internal |
| Thorough bar | ≥2 **productive** reads (not `package.json` / lockfiles), ≥1 change surface **plus** related support (2nd productive non-surface read or test), confidence ≠ `low` |
| Searches | Thorough Plan/Agent-visible: ≥1 search/glob for all taskSizes (`resolvePlanDiscoveryMinSearches`) |
| Symbols | When code-intel tools are granted and forced tool choice is supported |
| Fail closed | Engine clarify uses discovery pass `failed` via `shouldClarifyAfterPlanDiscovery` — never recompute with weaker options; thins discovery brief; Planning emits findings+A/B/C; Engine suspends for scope choice |
| Scope honored | After user picks A/B/C (`hasResolvedPlanScopeChoice`), do not re-clarify — keep `discover_and_plan` and draft a concrete plan (`plan_scope_choice_honored`) |
| Force exploration | Plan thorough does not skip shaped/search solely because a preferred path is known (`discovery_force_exploration`); if no shaped profile matches, query-derived search runs (`discovery_force_exploration_fallback`) |
| Follow-up sizing | Multi-item prior Ask guidance bumps planning `taskSize` ≥ medium |
| Prior paths | Ask-touched paths carry into context refs + discovery seeds (`plan_prior_path_hints_carried`) |
| Draft quality | Medium+/multi-item Plan rejects hollow single-surface skeleton → clarify (`plan_discovery_draft_required_clarify`) |

## Input / output

- **Input:** mode, exploration depth, query, conversation, strategy decision, planning depth, taskSize, discovery brief + collector stats.
- **Output:** strategy overrides (`discover_and_plan` / `clarify`), discovery pass budgets, sufficiency booleans, reason codes.

## Non-responsibilities

- Does not draft `PlanArtifact` (Planning owns that).
- Does not run tools (Engine `pinDiscoveryPass` owns the loop).
- Does not store host pending-plan UI state.

## Public exports

See `index.ts`: contract helpers, quality floor, discovery budgets.

## Tests

```bash
pnpm exec vitest run packages/v8/src/engine/v8-engine/modules/plan-discovery
pnpm exec vitest run packages/v8/src/engine/v8-engine/tests/eval/alwaysOn.goldens.spec.ts -t "G9|G10"
pnpm exec vitest run packages/v8/src/engine/v8-engine/tests/golden.behavioral.spec.ts -t "plan thorough"
```
