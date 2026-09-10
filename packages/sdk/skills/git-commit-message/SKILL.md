---
name: git-commit-message
title: Git commit message
description: Draft a compact conventional commit message from status, staged/unstaged diff, and recent log.
intents: [docs, feature, bugfix, refactor]
routes: [direct_answer, execute]
tags: [git, commit, conventional-commits, commit-message, scm]
sizeClass: S
priority: 190
conflictGroup: ship-commit
alwaysApply: false
enabled: true
when:
  - User asks for a commit message
  - Generate Commit Message / commit-message recipe
instruction: Inspect the provided git context; emit only the final commit message block. Do not run git commit unless asked.
---

# Planning

Discover:
- Prefer staged diff; else unstaged diff plus status
- Infer type: feat|fix|refactor|docs|test|chore|perf
- Read recent log for tone and scope conventions

Change:
- Subject ≤72 chars: `type(scope): why` (why, not file list)
- Optional body: 1–2 lines of why only
- Final reply is ONLY the raw commit message (no markdown fences, no preface)

Verify:
- No secrets in message or paths
- One logical change; omit drive-by notes

# Playbook

## Output template

```
type(scope): short why

Optional body explaining why.
```

## Rules

- Focus on why the change exists, not which files moved.
- Do not invent changes absent from the git context.
- Do not wrap the message in markdown fences.
- Do not commit, push, or amend unless the user explicitly asked.
