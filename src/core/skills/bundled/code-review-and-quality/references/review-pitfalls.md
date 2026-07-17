# Review Pitfalls and Rationalizations

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It works, that's good enough" | Working but unreadable/insecure/architecturally wrong code creates compounding debt. |
| "I wrote it, so I know it's correct" | Authors miss their own assumptions; every change benefits from another pass. |
| "We'll clean it up later" | Later rarely comes — use the review gate. |
| "AI-generated code is probably fine" | AI code needs more scrutiny; it is confident when wrong. |
| "The tests pass, so it's good" | Tests miss architecture, security, and readability issues. |
| "The refactor makes it cleaner" | Relocating complexity is not reducing it. |
| "It's only a small addition" | Small diffs still push files past healthy size. |

## Red Flags

- PRs merged without review
- Review that only checks whether tests pass
- "LGTM" without evidence
- Security-sensitive changes without security focus
- Large PRs that are "too big to review" (split them)
- Bug fixes without regression tests
- Comments without severity labels
- Accepting "I'll fix it later"
