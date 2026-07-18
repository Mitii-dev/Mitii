---
name: git-workflow-guidance
description: >-
  Advise on Git workflow: branching, atomic commits, trunk-based development, worktrees, merge/rebase strategy, and parallel development.
  Use for advice and planning only — not automatic execution.
---

# Git Workflow Guidance

## Quick Reference

- Advice and planning only — do **not** stage, commit, push, merge, rebase, tag, or delete branches from this skill.
- Prefer the repo's existing conventions over inventing a new branching model.
- Recommend the smallest safe workflow that matches the team's risk tolerance.

## Scope

Use when the user asks about:

- Branching strategy
- Atomic commits
- Trunk-based development
- Worktrees
- Merge vs rebase strategy
- Organizing parallel development

Do not use merely because code changed.

## Safety

If the user later asks to execute a write, hand off to the matching skill (`git-commit`, `github-pull-request`, `release-management`, etc.) with explicit approval gates.
