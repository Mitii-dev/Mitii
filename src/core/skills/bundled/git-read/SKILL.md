---
name: git-read
description: >-
  Read-only Git status, diff review, branch comparison, commit inspection, and repo state explanation.
  Use for status, diffs, and explaining repository state without writes.
---

# Git Read

## Quick Reference

- Remain **read-only** — no stage/commit/push/branch mutations.
- Prefer bounded diffs; cite commit hashes and files.
- Distinguish staged vs unstaged vs untracked.
- Do not start GitHub MCP or scan full history by default.

## Workflow

1. Inspect status (`git_status` / equivalent).
2. Review the requested diff scope (`git_diff`, compare branches if asked).
3. Summarize with hashes, paths, and risk notes.
4. Stop when the question is answered — do not escalate into commit/PR skills unless asked.

## Tools

Prefer: `git_status`, `git_diff`, `git_log`, `git_show`, `git_blame`, `git_compare_branches`, `git_tag_list`.
