---
name: agent-plan
description: Guide Agent mode when it invokes structured planning before execution; create concise executable plans, then execute and verify without replanning loops.
---

# Agent Plan

## Quick Reference

- Use the smallest executable plan that reduces risk for Agent mode.
- Plan for immediate execution, not for a standalone planning answer.
- Keep discovery read-only and focused on scope, dependencies, risk, and verification.
- Make each step concrete enough for tool execution: objective, files, tools, success criteria, phase, risk, and dependencies.
- Continue into execution after a valid plan unless approval, destructive risk, or a material user decision blocks progress.
- Replan only when a core assumption, safety boundary, architecture, or required dependency changes.

## Agent-Mode Planning Rules

1. Treat the generated plan as an execution contract for the current Agent turn.
2. Prefer direct execution for questions, diagnosis-only requests, and obvious single-step edits.
3. For planned work, inspect only enough code to identify affected areas, sequencing, risks, and verify commands.
4. Use phases deliberately:
   - diagnostics: read-only discovery, script scans, diagnostics, repo mapping.
   - review: read-only reasoning, impact checks, risk review, acceptance criteria.
   - execute: file edits, package changes, generated files, migrations.
   - verify: diagnostics, tests, lint, build, or manual validation.
5. Do not put writes in diagnostics or review steps.
6. Put foundational changes before dependents and make dependencies explicit.
7. Prefer vertical slices when a feature spans files, but avoid bloating the plan with ceremonial steps.
8. Every execute step needs a verifiable success criterion.
9. Every plan needs at least one verification path unless the request is documentation-only and no automated check exists.
10. If a verification command is unknown, add a narrow discovery step to read package manifests or script catalogs.

## Handoff Behavior

- In Agent mode, do not stop after showing the plan. Execute it unless the system is waiting for approval or clarification.
- If an active saved plan exists and the user says to continue, execute the saved plan instead of generating a new one.
- If the user asks for a new or different task, start fresh and do not resume the saved plan.
- If plan generation fails quality gates, fall back to direct execution only when the task can still be safely completed without the plan.

## Replanning

Replan only when:

- The requested scope changes.
- A required dependency, API, or file does not exist.
- The discovered architecture invalidates the planned sequence.
- A destructive operation, data migration, security-sensitive change, or public API change appears.
- Verification disproves a core assumption.

Do not replan for renamed files, equivalent helper choices, small test updates, or local implementation details that fit the current step.

## Completion

An Agent-mode plan is complete when it has enough ordered steps to execute safely, each step has a concrete outcome, verification is defined, risks are visible, and execution can begin immediately.
