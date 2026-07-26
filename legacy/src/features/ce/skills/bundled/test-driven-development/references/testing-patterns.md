# Testing Patterns Reference

## Arrange–Act–Assert
Keep tests readable: set up state, perform one action, assert outcomes.

## Prove-It (Bug Fixes)
1. Write a failing reproduction test.
2. Confirm it fails for the right reason.
3. Implement the minimal fix.
4. Confirm the test passes.
5. Add regression coverage for adjacent edge cases if needed.

## Test Names
Prefer behavior names: `rejects expired tokens`, not `testToken1`.

## What to Mock
- Mock I/O boundaries (network, clock, FS) when they obscure the unit under test.
- Prefer real collaborators for pure logic.
- Do not mock the system under test.

## Anti-Patterns
- Tests written only after the implementation "works"
- Tests that assert framework behavior instead of product behavior
- Brittle tests coupled to incidental markup/structure
- Skipping failing tests to green the suite
- Re-running the same suite twice with no intervening change

## Framework Notes
Follow the repository's existing runner (Vitest/Jest/Pytest/etc.). Match local patterns for fixtures, factories, and assertion style before inventing new ones.
