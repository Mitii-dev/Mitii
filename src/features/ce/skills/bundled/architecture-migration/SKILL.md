---
name: architecture-migration
description: Plan and execute cross-package restructuring through explicit current-state, move-map, compatibility, and boundary-verification stages.
---

# Architecture Migration

## Quick Reference

1. Map current package and dependency boundaries.
2. Define the target state and invariants.
3. Produce a source-to-target move map.
4. Split migration into compatibility-preserving slices.
5. Verify imports, public APIs, tests, and architecture boundaries.

## Ask Guidance

- Describe current boundaries before recommending a target.
- Cite dependency and entry-point evidence.
- Distinguish required migration work from optional cleanup.

## Planning Guidance

- Require a current-state map and target-state contract.
- Include explicit move operations, compatibility shims, and sequencing.
- Add boundary, import, build, and consumer verification.

## Agent Execution Guidance

- Execute one migration slice at a time.
- Preserve public contracts until all consumers move.
- Avoid simultaneous unrelated renames or formatting churn.

## Verification Guidance

- Run architecture-boundary checks.
- Verify typecheck/build and affected package tests.
- Search for stale imports and old paths.

## Failure Behavior

- Pause when the target boundary is ambiguous or a public compatibility decision is missing.
