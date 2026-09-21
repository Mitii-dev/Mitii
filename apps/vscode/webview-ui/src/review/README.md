# Review bar (webview)

Composer strip above the Mitii chat input. Host ownership stays in `apps/vscode/src/`
(`reviewDiff.ts`, `review/reviewFindingsPresenter.ts`); this folder is UI + scope rules only.

## Dual-scope contract

| Action / surface | Data source | LLM |
|---|---|---|
| Summary (`2 file changes`) | Latest run `RunFileChangesView` | No |
| **Review** + Files tab | Same chat/run edits | No |
| **Code Review (N)** | Full git `ReviewDiffView` (`N` = file count) | Yes |
| Findings tab, severity chips, Fix / Fix all | Present only when `ui.features.codeReviewButton` is on | After Code Review |

```text
› 2 file changes     Undo All · Keep All · Review | Code Review (21)
```

- Left count = what **this chat** changed.
- `Code Review (21)` = analyze **all** dirty git files (staged + unstaged + untracked as reported by `buildReviewDiff`).

## Feature gate

`Settings → Features → Code Review` (`mitii.ui.features.codeReviewButton`):

- **Off:** bar shows chat file changes + Review. No Code Review CTA, no Findings tab, no Fix.
- **On:** Code Review CTA with git count; findings appear after a review run with criticality + Fix.

## Modules

| File | Role |
|---|---|
| `reviewBarModel.ts` | Pure scope resolution (MUST stay host-free) |
| `WorkingTreeReviewBar.tsx` | Orchestrator |
| `ReviewBarActions.tsx` | Undo / Keep / Review / Code Review / Fix |
| `ReviewFilesPanel.tsx` | Chat file list |
| `ReviewFindingsPanel.tsx` | Finding chips by severity |

## Tests

`webview-ui/tests/reviewBarModel.test.ts` — scope visibility, labels, and gating.
