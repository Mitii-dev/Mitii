# TDD Pitfalls and Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll write tests after the code works" | Post-hoc tests lock in implementation, not behavior. |
| "This is too simple to test" | Simple code grows; the test is the spec. |
| "Tests slow me down" | They slow you now and speed every later change. |
| "I tested it manually" | Manual checks do not persist. |
| "It's just a prototype" | Prototypes become production; start with proof. |

## Red Flags
- Code without corresponding tests
- First-run green tests that may not assert the intended behavior
- Bug fixes without reproduction tests
- Skipped/disabled tests to force green
