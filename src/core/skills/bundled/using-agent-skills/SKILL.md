---
name: using-agent-skills
description: >-
  Resolve ambiguity between multiple Mitii skills or sequence skills for compound tasks.
  Use when several playbooks could apply, the user asks about skill usage, or stages must be ordered.
  Do not use for ordinary single-intent tasks.
---

# Skill Selection Guidance

## Quick Reference

- Prefer **one** primary skill; add a second only for a distinct required workflow.
- Cap: normal=1, multi-step≤2, compound release/cross-system≤3.
- Exact intent and artifact type beat broad workflow skills.
- Do not load Git/GitHub, TDD, review, cleanup, security, or performance skills automatically after every edit.
- Call `use_skill("<name>")` only when the playbook is not already injected.
- Stop discovery after a confident selection.

## Selection Priority

1. Explicit user-selected skill
2. Exact task intent match
3. Explicit file or artifact type
4. Current route (including Git route injection)
5. Relevant project capability
6. General workflow fallback

## Skill Catalog (link by name)

| Domain | Skill names |
| --- | --- |
| Meta / plan | `using-agent-skills`, `agent-plan`, `planning-and-task-breakdown` |
| Quality | `code-review-and-quality`, `code-smells-and-tech-debt`, `test-driven-development` |
| Debug / perf | `debugging-and-error-recovery`, `performance-optimization`, `log-audit` |
| Cleanup / env | `audit-cleanup`, `environment-and-secrets` |
| Browser | `browser-testing-with-devtools` |
| Git read/write | `git-read`, `git-history-analysis`, `git-commit-message`, `git-commit`, `git-workflow-guidance` |
| GitHub / release | `github-pull-request`, `github-issues`, `github-actions`, `changelog-maintenance`, `release-management` |

## Planning Gate

Select planning only when the user asks for a plan, multiple dependent components must change, migration/destructive action is involved, material ambiguity affects behavior/security/data/cost/API, or implementation cannot safely begin with one clear edit.

## Sequencing Examples

```text
Bug fix: debugging-and-error-recovery → test-driven-development
Changelog + PR: changelog-maintenance → github-pull-request
Release: release-management
Cleanup: audit-cleanup (script-first)
```

Prefer one orchestrating skill over loading every underlying skill separately.

## Verification by Route

- Code change → targeted tests / typecheck / build
- Commit message → message validation only
- Log analysis → evidence + arithmetic validation
- Git op → repository-state verification
- GitHub remote write → remote-result verification after explicit approval
- Config/secrets → key names only; never secret values

## Completion

Selection is complete when one primary skill (or none) is chosen, supporting skills have distinct jobs, irrelevant skills are excluded, and the soft cap is respected. Then stop discovery and execute.
