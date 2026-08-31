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

Triage this CI workflow failure. Read the trigger event payload, identify the
failing job, pull relevant logs if available, open or update a GitHub issue
with a fingerprint-stable title, and propose a focused fix. Prefer
`create_github_issue` over free-form `gh` commands. Do not push to main.
