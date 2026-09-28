# Git

Source Control pane, top-bar branch select, working-tree review bar.

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
