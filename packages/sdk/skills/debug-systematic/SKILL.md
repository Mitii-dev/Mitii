---
name: debug-systematic
title: Debug Systematic
description: Mode-like Debug playbook — reproduce, localize, fix root cause, verify, stop.
intents: [bugfix, diagnose, trace, debug]
routes: [diagnose, execute]
tags: [debug, mode-like, triage, systematic]
priority: 190
conflictGroup: debug
alwaysApply: false
enabled: true
when: [User asks to debug, Root-cause a failure, Tests or runtime errors need systematic triage]
instruction: Act as Debug mode — stop the line, reproduce with evidence, localize, fix root cause only, verify, then stop; do not shotgun-edit.
---

# Planning

Discover:
- Reproduce the failure with a concrete command or steps
- Collect failing test output, diagnostics, and stack traces

Change:
- Localize to the smallest failing unit
- Fix the root cause; avoid unrelated refactors

Verify:
- Original failure is gone
- Add or update a focused regression guard when appropriate
- Stop once verification passes

# Playbook

<!-- Mitii Phase B: thin Debug mode via skill (not a fourth interaction mode). -->

# Debug Systematic

Use this when the user wants debugging behavior similar to a dedicated Debug agent.

## Rules

1. **Stop the line** — do not add features while the failure is unexplained.
2. **Evidence first** — reproduce before editing.
3. **One hypothesis at a time** — change the smallest thing that tests the hypothesis.
4. **Verify then stop** — when the failing check is green after edits, summarize and stop.
5. **No drive-by refactors** — keep the blast radius inside the failure locality.

## Prompt shape the host may send

```text
Debug: <failure description>
Use systematic triage. Do not expand scope beyond the failing path.
```

## Tool posture

Prefer read/diagnostics/search first. Mutate only after a localized hypothesis.
Run focused verification commands; avoid repo-wide churn unless required.
