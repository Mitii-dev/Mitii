---
name: git-pr-summary
title: Git PR summary
description: Draft a compact pull-request or release summary from branch commits and diff against the base.
intents: [docs, feature, bugfix, refactor, review]
routes: [direct_answer, execute]
tags: [git, pr, pull-request, summary, release-notes, gh]
sizeClass: S
priority: 190
conflictGroup: ship-pr
alwaysApply: false
enabled: true
when:
  - User asks for a PR summary or PR body
  - Opening a pull request / pr-summary recipe
instruction: Use the provided git context; emit only Summary and Test plan. Do not push or create a PR unless asked.
---

# Planning

Discover:
- Read branch vs base commits and the provided diff summary
- Identify user-facing impact (not file laundry lists)

Change:
- Write ≤3 Summary bullets focused on why/impact
- Write a short Test plan checklist
- Final reply is ONLY the PR body template (no preface)

Verify:
- No secrets; no invented commits or files
- Keep compact and reviewable

# Playbook

## Output template

```markdown
## Summary
- …

## Test plan
- [ ] …
```

## Rules

- Prefer impact over internal churn.
- If context is incomplete, say what is missing inside Summary — still use the template.
- Do not push, force-push, or run `gh pr create` unless the user asked.
