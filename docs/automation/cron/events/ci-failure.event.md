---
name: ci-failure-triage
title: CI Failure Triage
trigger: event
event: github.workflow_run.completed
filter.conclusion: failure
dedupeWindowSeconds: 3600
cooldownSeconds: 300
maxParallel: 1
mode: agent
autonomyPreset: apply
enabled: true
---

Triage this CI workflow failure.

1. Use the Suggested ticket fingerprint from the trigger context when present.
2. Read the payload / evidence pack; identify the failing job.
3. Open or update a GitHub issue with `create_github_issue` and that `fingerprint`
   (idempotent: comments on an existing `[mitii:<fingerprint>]` issue).
4. If a fix is verified, put it on a feature branch and optionally
   `create_pull_request` as a draft. Never push to main.
