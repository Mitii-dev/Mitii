# Git

Source Control pane and top-bar branch select.

## File map

| Path | Role |
|------|------|
| `GitWorkingTreePane.tsx` | Thin facade (export used by `WorkspacePanel`) |
| `scmTypes.ts` | `ScmGroupKey`, `ScmJob`, `JOB_LABEL`, context-menu + props types |
| `scmPathUtils.ts` | `fileLeaf` / `fileDir` display helpers |
| `upsertWorkspaceMarkdown.ts` | Save-or-create workspace markdown file |
| `changelogMerge.ts` | Merge a generated section into `CHANGELOG.md` |
| `hooks/useGitWorkingTreeStatus.ts` | Snapshot, derived maps, `loadGit`, refresh effects |
| `hooks/useScmSelection.ts` | Multi-select, context menu state + dismiss |
| `hooks/useScmJobs.ts` | Recipe / stream jobs (commit message, changelog, release notes, PR, code review) |
| `hooks/useScmMutations.ts` | `busy` + stage / unstage / discard / commit / stash |
| `ScmPaneHeader.tsx` | Title, running job, stop, Code Review, refresh |
| `ScmCommitBox.tsx` | Message box, Generate / Commit, Changelog + More menu |
| `ScmResourceGroup.tsx` | Staged / Changes group and file rows |
| `ScmContextMenu.tsx` | Stage / Unstage / Stash menu |
| `ScmReviewPanel.tsx` | Code Review findings list |
| `TopBranchSelect.tsx` | Top-bar branch select |

- The post-run working-tree review bar is composer UI and lives in `chat/` (`WorkingTreeReviewBar.tsx`, `ComposerReviewStrip.tsx`).
- Engine: `engine/git/`
- Contract: `shared/git/workingTree.ts`
- HTTP: `/v1/git/*` via `engine/server.ts`

## Source Control UX

- **Changes** includes untracked files (no separate Untracked group).
- Multi-select + right-click: **Stage**, **Unstage**, **Stash**.
- Commit is traditional: stage first, then Commit (no “Stage all & commit”).
- Header shows the active job (Commit message / Changelog / Code Review…) with a **stop** control.
- **Code Review (N)** opens findings in the lower panel (severity, path, message, snippets).

## Writing actions

| Action | Placement | Behavior |
|--------|-----------|----------|
| Generate | Beside Commit | Fills the commit message box |
| Changelog | Primary recipe | Runs and updates/creates `CHANGELOG.md` |
| PR summary | More menu | Copies draft to clipboard (for a future Create PR flow) |
| Release notes | More menu | Writes `RELEASE-NOTES.md` |
