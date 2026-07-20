---
name: test-driven-development
description: Red/Green/Refactor and Prove-It bug fixes for logic and behavior changes. Use when implementing or fixing verifiable behavior; not for pure docs, config, git, or log-only work.
---

# Test-Driven Development

## Quick Reference

- New behavior: Red → Green → Refactor. Bugs: Prove-It (failing repro test first).
- Tests are the durable spec — “seems right” is not done.
- Skip for pure docs/config/static content, and for git/log-only tasks (use those skills instead).
- Common supporting/default skill for implementation and bugfix — not a substitute for docs, git, or log-audit playbooks.
- Patterns: `references/testing-patterns.md`. Pitfalls: `references/tdd-pitfalls.md`.

## When to Use / Not

**Use:** new logic/behavior; bug fixes; modifying existing functionality; edge-case handling; any change that can break behavior.

**Do not use:** pure documentation, config-only, static content with no behavior change; commit/PR/git operations; log analysis/audit.

## Red → Green → Refactor

1. **RED** — Write a failing test for the desired behavior. A test that passes immediately proves nothing.
2. **GREEN** — Write the minimum code to pass. Do not over-engineer.
3. **REFACTOR** — Clean up with tests still green (extract, rename, dedupe). Re-run after each step.

Prefer unit/small tests for pure logic; integration for boundary crossings; few E2E for critical flows. Assert on outcomes (state), not internal call sequences. Prefer real implementations > fakes > stubs > mocks (mock only slow/nondeterministic/side-effect boundaries). Name tests as specifications; one concept per test. See references for DAMP-vs-DRY and anti-patterns.

## Prove-It (Bug Fixes)

1. Write a test that reproduces the bug — it must fail.
2. Implement the minimal fix.
3. Confirm the test passes.
4. Run the nearest suite for regressions.

Do not start by patching production code before the failing repro exists (unless no test harness can express the failure — then document the manual repro and add the closest automated guard).

## Ask Guidance

- Stay read-only; suggest which failing test to add and what assertion proves the behavior.
- Critique existing tests for outcome-vs-interaction and isolation issues when asked.

## Planning Guidance

- Include the RED test step before implementation tasks.
- Name concrete test files/cases and verify commands.
- Do not plan TDD ceremony for docs/config/git/log routes.

## Agent Execution Guidance

- For new behavior: failing test first, then minimal implementation, then refactor if needed.
- For bugs: Prove-It sequence; do not skip the failing repro.
- Do not disable or skip failing tests to “make green.”
- After a clean run, do not re-run the same command on unchanged code.

## Verification Guidance

- Every new behavior has a corresponding test.
- All relevant tests pass.
- Bug fixes include a repro that failed before the fix.
- No skipped/disabled tests introduced for the change.
- Coverage not decreased when tracked.

## Failure Behavior

- Cannot express a useful automated test → state why, use the best available guard, and get user confirmation before claiming done.
- RED never fails → the test is wrong; fix the test before implementing.
- GREEN cannot pass without large unrelated changes → stop and reassess scope/design.

## Forbidden Actions

- Implementing first and adding tests only if convenient
- Claiming done based on manual “seems right” when tests are feasible
- Testing framework/library internals instead of project behavior
- Snapshot abuse without review
- Applying this skill to pure docs, config, git, or log-audit tasks
