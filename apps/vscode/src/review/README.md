# Review (host)

Host-side review support for the VS Code sidebar. Webview dual-scope UI lives in
`apps/vscode/webview-ui/src/review/README.md`.

## Contract

| Concern | Module | Notes |
|---|---|---|
| Git working-tree snapshot | `../reviewDiff.ts` → `buildReviewDiff` | Feeds `setReviewDiff` / Code Review `(N)` |
| Per-file patches for LLM prep | `buildReviewFileDiffs` | Used when assembling review context |
| Finding parse + severity | `reviewFindingParse.ts` | Tool-output → finding DTO |
| Editor Problems + comment threads | `reviewFindingsPresenter.ts` | Severity-mapped diagnostics |
| Feature gate | `mitii.ui.features.codeReviewButton` | Sidebar persists via settings |

## Dual scope (must stay aligned with webview)

1. **Review** in the composer strip lists **this chat’s** `run.fileChanges` only.
2. **Code Review (N)** always analyzes the **full** git working tree from `buildReviewDiff`.
3. Findings / Fix surfaces only when the Code Review feature flag is on.

Do not collapse these scopes in the host prompt for Code Review — the model MUST see the full dirty tree, not only the latest Mitii run.
