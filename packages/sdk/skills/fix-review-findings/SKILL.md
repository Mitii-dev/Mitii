---
name: fix-review-findings
title: Fix review findings
description: Apply localized fixes for structured Mitii review findings without re-reviewing or expanding scope.
intents: [bugfix, refactor]
routes: [execute]
tags: [review, fix, localized]
priority: 160
conflictGroup: build
alwaysApply: false
enabled: true
when: [User asks to fix Mitii review findings, Fix / Fix all after a working-tree review]
instruction: Fix only the listed review findings with the smallest safe edits; do not re-emit findings, wander into unrelated files, or rewrite beyond the anchors.
---

# Planning

Discover:
- Read each listed finding path at the anchored lines
- Prefer `existingCode` / `suggestionCode` when present

Change:
- Apply the smallest patch that addresses each finding
- Stay inside the listed paths unless a finding requires a one-file dependency

Verify:
- Finding symptom is gone
- No drive-by refactors or new review pass

# Playbook

<!-- Mitii host recipe: fix-review-findings. Override: <workspace>/.mitii/skills/fix-review-findings/SKILL.md -->

# Fix Review Findings

## Goal

Turn structured Mitii review findings into **localized code fixes**. This is
mutation work in Agent mode. Do **not** call `emit_review_finding`. Do **not**
start a new review.

## Rules

1. **Only the listed findings.** Treat the prompt list as the entire scope.
2. **Anchor first.** Open the path and use `startLine` / `existingCode` before editing.
3. **Prefer the suggestion.** If `suggestionCode` is present and still applies, use it as the primary patch guide.
4. **Smallest change.** Prefer a few-line edit over a rewrite. Match surrounding style.
5. **No wandering.** Do not "while I'm here" cleanups, renames, or unrelated files.
6. **No second review.** After fixes, briefly summarize what changed; do not re-run review tooling.

## Order

1. Highest severity first (critical → high → medium → low → info)
2. Within the same severity, keep file order from the prompt
3. After each file's fixes, continue to the next finding

## Done when

Every listed finding is addressed or explicitly skipped with a one-line reason
(e.g. already fixed, finding no longer matches code).
