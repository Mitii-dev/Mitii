---
name: git-workflow-guidance
description: Use only when the user asks for Git workflow advice: branching strategy, atomic commits, trunk-based development, worktrees, merge strategy, rebase strategy, or organizing parallel development.
---

# Git Workflow Guidance

Use this skill for advice and planning, not automatic execution.

## Scope

Use when the user asks about:

- Branching strategy
- Atomic commits
- Trunk-based development
- Worktrees
- Merge strategy
- Rebase strategy
- Organizing parallel development

Do not use merely because code changed. Do not stage, commit, push, merge, rebase, tag, or delete branches from this skill.

## Safety

Destructive Git operations require explicit user approval. This includes forced branch deletion, reset, clean, history rewriting, force-push, and remote merges.

Prefer advice that preserves local work:

- Inspect status before any write.
- Keep commits atomic and reviewable.
- Prefer short-lived branches.
- Use worktrees for parallel streams when branch switching would disturb local edits.
- Separate release, changelog, and PR publishing into verified stages.

## Output

Give concise, repository-aware guidance. Separate confirmed repository facts from recommendations.
