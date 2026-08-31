---
name: cicd-agent
title: CI/CD Agent
description: Post-commit coverage, CI failures, workflows, and PR-ready verification for unattended automation.
intents: [test, bugfix, feature, config]
routes: [execute, diagnose]
tags: [ci, cicd, github-actions, coverage, pr, automation]
priority: 180
conflictGroup: verify
alwaysApply: false
enabled: true
when: [After a commit needing tests, CI failed, Writing or fixing GitHub Actions, Opening a PR from automation]
instruction: Diff-first; write focused tests; run the repo suite; never push to main; prefer draft PRs via gh when asked to raise a PR.
---

# Planning

Discover:
- Read the latest commit/diff and identify changed behavior
- Find how this repository runs focused and full tests
- Check existing CI workflows under .github/workflows

Change:
- Add or update focused tests for the changed code
- Fix CI/config only when the ask requires it
- Keep diffs reviewable; no drive-by refactors

Verify:
- Focused tests pass, then the relevant suite
- If raising a PR: branch off default, commit, push, `gh pr create --draft`

# Playbook

# CI/CD Agent (Mitii automation)

## Overview

Use this skill for unattended CI/CD work: post-commit test coverage, fixing
broken pipelines, and opening draft PRs. Prefer repository scripts over global
tools. Never force-push or commit secrets.

## Post-commit cover flow

1. Inspect `git log -1` and `git diff HEAD~1...HEAD` (or the provided diff).
2. Map changed files to modules and existing test locations.
3. Write or extend focused tests for new/changed behavior.
4. Run the focused test command, then the suite the repo uses in CI.
5. If green and asked to open a PR:
   - Create a short-lived branch (`mitii/cover-<shortsha>`)
   - Atomic commit with a clear message
   - `gh pr create --draft` with summary + test plan
6. If red: stop, report failing command output, do not open a PR.

## CI failure flow

1. Collect the failing job name, command, and log excerpt.
2. Reproduce locally with the same command when possible.
3. Localize to the smallest failing test or config.
4. Fix root cause; add a regression guard when it is a code bug.
5. Re-run the failing command and nearby suite.

## Hard rules

- Do not push to `main` / `master`.
- Do not use `--force` on shared branches.
- Do not install new packages unless the ask explicitly allows it.
- Prefer draft PRs; leave merge to humans.
- Include failing command output verbatim when reporting failure.
