---
name: bugfix-workflow
description: Reproduce, diagnose, minimally fix, and regression-test software defects. Use for concrete bugfix tasks; not for explanation-only requests.
---

# Bugfix Workflow

## Quick Reference

1. Reproduce or establish a deterministic failing signal.
2. Trace the failure to the smallest supported root cause.
3. Apply the minimal compatible fix.
4. Rerun the reproduction.
5. Run focused regression verification.

## Ask Guidance

- Stay read-only.
- Separate observed evidence from hypotheses.
- Explain the root cause with file and symbol references.

## Planning Guidance

- Include reproduction evidence before implementation steps.
- Identify regression coverage and rollback concerns.
- Avoid speculative cleanup outside the defect boundary.

## Agent Execution Guidance

- Preserve a failing signal before editing when practical.
- Make the smallest change that resolves the confirmed cause.
- Do not bundle unrelated refactors.

## Verification Guidance

- Rerun the original reproduction.
- Run the nearest affected tests, typecheck, or build.
- Report verification that could not run.

## Failure Behavior

- If the failure cannot be reproduced, stop before speculative edits and report the missing evidence.
