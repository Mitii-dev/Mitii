---
name: planning-and-task-breakdown
description: Create implementation plans for multi-step, ambiguous, risky, or cross-component work. Use when asked for a plan or dependent changes must be coordinated. Do not use for questions, commit messages, or single-step fixes.
---

# Planning and Task Breakdown

## Quick Reference

- Pick the smallest useful depth: None → Micro → Short → Standard → Full.
- Every task needs a concrete change, acceptance criteria, and a verify step.
- Order foundational work before dependents; prefer verifiable vertical slices.
- Replan only when scope, architecture, safety, or a core assumption changes.
- Ask the user only when an unresolved decision changes behavior, security, data, cost, API, or destructive ops.

## Depth Budgets

| Depth | When | Limit |
| --- | --- | --- |
| None | Direct, obvious, low-risk | Execute without a visible plan |
| Micro | One small change, minor risk | ≤3 bullets, ≤80 words |
| Short | 2–4 related tasks | ≤4 tasks, ≤250 words |
| Standard | Multi-component with dependencies | ≤8 tasks, ≤800 words |
| Full | Cross-cutting, ambiguous, destructive, migration | ≤12 top-level tasks, ≤1,500 words |

## Rules

1. Planning must reduce uncertainty rather than delay execution.
2. Do not produce a visible plan for questions, commit messages, status checks, or obvious single-step edits.
3. Inspect only enough code to identify scope, dependencies, risks, and verification.
4. Order foundational changes before dependent changes.
5. Prefer independently verifiable vertical slices.
6. Every task must describe a concrete change and a testable outcome.
7. Include only relevant metadata — do not add files, parallelization, risks, or stop conditions mechanically.
8. Add checkpoints only after meaningful risk boundaries or completed vertical slices.
9. Stop planning after reaching the selected depth.
10. Do not regenerate or expand the plan unless scope, architecture, safety, or a core assumption changes.
11. Do not create a second plan for minor implementation discoveries.
12. Ask the user only when an unresolved decision changes behavior, security, data, cost, public API, or destructive operations.

## Compact Task Format

```markdown
## Task N: Title

**Change:** Concrete implementation work.

**Acceptance:**
- Testable outcome

**Verify:** Command or manual check

**Depends on:** Task N or none
```

Micro-plan for small but nontrivial work:

```markdown
Plan:
- Change: One sentence
- Verify: Command or manual check
- Risk: Low, medium, or high with a brief reason
```

## Replanning

Replan only when the user changes scope, a required dependency is missing, implementation conflicts with expected architecture, a destructive operation becomes necessary, or verification disproves a core assumption.

Do not replan for filename differences, minor test adjustments, equivalent helper reuse, or local implementation details.

## Completion

A plan is complete when scope is bounded, dependencies are ordered, each task has a testable outcome, verification is defined, relevant risks are identified, and the plan fits its depth budget. Then stop planning and proceed to execution.
