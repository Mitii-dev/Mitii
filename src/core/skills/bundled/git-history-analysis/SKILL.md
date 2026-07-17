---
name: git-history-analysis
description: >-
  Summarize recent history, file history, blame, release history, hotspots, and when a change was introduced.
  Use for bounded git log/blame analysis — not for rewriting history.
---

# Git History Analysis

## Quick Reference

- Use **bounded** commit ranges and file scopes.
- Calculate statistics deterministically; separate facts from hypotheses.
- Do not judge developer performance from commit counts.
- Do not expose author emails by default.
- Do not run `git bisect` automatically.

## Workflow

1. Clarify the question (when introduced, who last touched, hotspot summary, release history).
2. Bound the range (N commits, path, tag..tag).
3. Gather evidence with `git_log` / `git_show` / `git_blame`.
4. Report confirmed facts first; label inferences clearly.
5. Suggest next skills only if the user wants a fix (`debugging-and-error-recovery`) or a commit.

## Safety

Read-only. No rebase, amend, force-push, or history rewrite from this skill.
