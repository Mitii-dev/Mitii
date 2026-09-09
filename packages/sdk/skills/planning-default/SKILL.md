---
name: planning-default
title: Default Planning
description: Plan repository work with Discover, Change, and Verify phases.
intents: [feature, bugfix, refactor, migrate, scaffold, test, config, dependency, optimize, security, schema, mock, docs, style]
routes: [plan]
tags: [plan, discover, verify, change]
sizeClass: S
priority: 180
conflictGroup: planning
alwaysApply: false
when: [You are in Plan mode and the task needs multiple steps, The user asks for a plan]
instruction: Use Discover, Change, and Verify phases; discover current behavior before edits, keep changes minimal, and verify with lint/typecheck/tests. Do not implement during planning.
---

# Agent Discovery

Discover:
- Locate current behavior
- Collect evidence

Change:
- Choose non-hardcoded extension approach
- Implement smallest coherent change

Verify:
- Run lint/typecheck/tests
