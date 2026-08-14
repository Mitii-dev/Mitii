# Planning

Status: implemented
Facade: `PlanningPipeline`
Primary outcome: envelope signals + decision depth → generic `PlanArtifact`

## Owns

- Dimension-driven plan drafting (scope, risk, clarity, complexity, change impact)
- Plan validation and budget compaction
- Serialization helpers for prompts and answers
- Optional `skills` / `processHints` slots for future process profiles

## Must not own

- Route / authority decisions (`decision-policy`)
- Run suspension / resume (`agent-engine`)
- Tool execution or repository indexing
- Hard-coded plan types (`bugfixPlan`, `migrationPlan`, …)

## Flow

```text
validate PlanningInput
  → draftPlan (or revise priorPlan)
  → validatePlan
  → compactPlan
  → PlanningResult { plan? }
```

## Invariants

1. One `PlanArtifact` shape for all task kinds.
2. `skills` and `processHints` may bias sections/questions; they must not switch plan schemas.
   Skill Discover/Change/Verify methodology bullets must not replace executable plan steps.
   Dimension-driven steps should stay request-specific (targets, constraints, acceptance checks).
   Repair vs feature step shape comes from intent taxonomy only — no language/tool keyword sniffing.
3. `planningDepth === "none"` returns `status: "blocked"` without a plan.
4. Planning never grants tools or mutates the workspace.
