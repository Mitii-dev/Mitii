# Git (desktop)

Agent working-tree / SCM pane.

| Layer | Location |
|---|---|
| UI | `GitWorkingTreePane.tsx`, `WorkingTreeReviewBar.tsx` |
| Engine | `engine/git/` |
| Shared DTOs | `shared/git/workingTree.ts` |
| HTTP | `/v1/git/*` |

Safe argv-only git mutations. Do not shell-interpolate user paths.
