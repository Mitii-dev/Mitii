---
name: medium-planning
title: Medium Task Planning
description: Bounded investigation then a short concrete implementation plan with targets and verification.
intents: [feature, bugfix, refactor, migrate, test, schema, optimize, security, mock, config]
routes: [plan, execute]
tags: [plan, medium, discovery, tasks, verification]
sizeClass: M
priority: 200
conflictGroup: planning
alwaysApply: false
enabled: true
when: [The task is medium-sized across a few related files, Implementation surface must be understood before changing it]
instruction: Use discovery evidence only. Produce a short ordered plan with concrete targets and verification; do not invent files or explore the whole repo.
---

# Planning

Discover:
- Start from seed, explicit paths, diagnostics, or trusted surfaces
- Read entrypoint, direct dependencies, and focused tests only
- Stop when change surface and verification surface are known

Change:
- Ordered concrete steps with file or symbol targets
- Preserve existing behavior called out in the ask
- No invented files or unrelated cleanup

Verify:
- Prefer existing focused tests and known checks
- Do not invent commands when verification method is unknown

# Playbook

<!-- Mitii Medium planning. Override: <workspace>/.mitii/skills/medium-planning/SKILL.md -->

# Medium Planning

Medium tasks need enough investigation to understand the change, not enough to map the whole repository.

Flow: **Anchor → Understand → Follow direct connections → Freeze → Plan**

## Scope

Do not explore unrelated files, invent implementation surfaces, redesign architecture, or keep discovering after the change is understood. If evidence is thin, name the gap instead of guessing.

This skill does not choose discovery tools, strategy, or authoritative paths — use Engine discovery evidence.

## Step shape

```markdown
### Step N: [Concrete change]
- Target: `path/to/file.ts`
- Change: [What needs to change]
- Preserve: [Relevant existing behavior, if any]
- Verify: [How this step is checked]
```

Prefer a short sequence: primary contract/entrypoint → implementation → direct deps → tests → verify.

## Example

Ask: add optional `discountCode` through DTO → service → repository.

1. Extend `CreateOrderDto` with optional field (existing validation style).
2. Pass through `OrderService.createOrder` without breaking the no-code path.
3. Persist in `OrderRepository`.
4. Update focused order tests for with/without the field.

Targets must come from discovery evidence, not assumed paths.
