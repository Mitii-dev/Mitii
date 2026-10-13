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
| Fail closed | Engine clarify uses discovery pass `failed` via `shouldClarifyAfterPlanDiscovery` — never recompute with weaker options. **Clear single-outcome asks** (`askNeedsPlanScopeFork` = false) draft from available evidence instead of forcing harness A/B/C |
| Scope fork suspend | Only when `askNeedsPlanScopeFork` (explicit A/B/C or tests-or-architecture multi-outcome). Substantive feature/bugfix/refactor asks never get harness chips — even if deterministic clarity was downgraded to unclear for missing file targets. Agent campaign phase-lock requires `askNeedsScopeFork === true` plus `forceCampaignPhaseLock`. Runs **before** Agent `task_list_plan_not_concrete` |
| Clarify draft | `ensurePlanClarifyDraft` synthesizes findings+A/B/C only when the ask needs a scope fork; leftover `clarify` strategy on clear asks remaps to `discover_and_plan` and still hits the concreteness task-list gate |
| Visible depth | Long Agent briefs and multi-outcome campaigns force `planningDepth: visible` before Officer medium→internal (`long_prompt_visible_plan` / `multi_outcome_campaign_visible_plan`) |
| Scope honored | After user picks A/B/C (`resolvePlanScopeId`), do not re-clarify — keep `discover_and_plan` and draft a concrete plan (`plan_scope_choice_honored`) |
| Scope bounds | Chosen scope narrows preferred paths + impact seeds and scales the discovery envelope (`plan_scope_bounds_applied` / `scaleDiscoveryPassBudget`) |
| Next phase | Campaign A/B handoff only when the ask was a true multi-outcome fork (`askNeedsPlanScopeFork`); clear feature runs do not append harness leftovers |
| Force exploration | Thorough Plan / Agent-visible does not skip shaped/search solely because a preferred path is known (`discovery_force_exploration`); if no shaped profile matches, query-derived search runs (`discovery_force_exploration_fallback`) |
| Follow-up sizing | Multi-item prior Ask guidance bumps planning `taskSize` ≥ medium |
| Prior paths | Ask-touched paths carry into context refs + discovery seeds (`plan_prior_path_hints_carried`) |
| Draft quality | Medium+/multi-item Plan rejects hollow single-surface skeleton → clarify only when the ask needs a scope fork; clear single-outcome asks keep drafting from discovery (`plan_discovery_draft_required_clarify`) |

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
