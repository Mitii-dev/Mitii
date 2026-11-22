# working-tree-review

Shared review-finding model for the composer review strip in Desktop and the VS Code webview.

## Responsibility

- `ReviewFindingChip`: the finding row DTO both hosts render (`status` is `open` or `fixed`).
- `summarizeReviewFindings`: pure split into open / fixed plus a `complete` flag (findings exist and all are fixed).

## Input / output

`readonly ReviewFindingChip[]` in, `ReviewFindingSummary` out. No React, no host calls.

## Not shared (and why)

`WorkingTreeReviewBar` and `ComposerReviewStrip` stay in each host. The two bars share under a quarter of their props and markup:

| Concern | Desktop | VS Code webview |
|---|---|---|
| Data | Git-panel file entries with inline patch preview | Run changes plus a separate git `ReviewDiffView` |
| Layout | One card; per-file inline diff | Attached bar with Files / Findings tabs |
| Actions | View · Undo · Fix all · Dismiss | Undo All · Keep All · Review · per-finding Fix |
| Class names | `composer-changes*` | `wt-review*` |

Unifying them would need a class-name map plus SCM-specific file and diff models, which would leak host wiring into this package. Revisit when the hosts agree on one layout.

## Failure modes

An empty list yields zero counts and `complete: false`.
