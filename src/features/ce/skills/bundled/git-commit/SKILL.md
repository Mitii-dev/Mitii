---
name: git-commit
description: >-
  Stage and create a local Git commit after explicit user request and approval.
  Use for local commits only — never push, force, or skip hooks automatically.
---

# Git Commit

## Quick Reference

1. Inspect status; identify staged/unstaged/untracked/conflicted files.
2. Detect secrets and generated files before staging.
3. Stage only explicitly intended files — never blind `git add .`.
4. Generate the message from the selected staged diff.
5. Create **one** commit after explicit approval; verify hash and files.
6. Never `--no-verify`, amend, or push automatically.

## Workflow

1. Inspect Git status.
2. Identify staged, unstaged, untracked, ignored, and conflicted files.
3. Detect secrets and generated files.
4. Stage only explicitly intended files.
5. Generate the commit message from the selected staged diff (or use `git-commit-message`).
6. Create one commit after explicit approval.
7. Verify the resulting commit.
8. Report commit hash and included files.

## Safety

Never commit secrets or unresolved conflicts. Never amend unless the user explicitly asks and policy allows.
