---
name: post-commit-cover-event
title: Post-commit cover (push)
trigger: event
event: github.push
dedupeWindowSeconds: 600
cooldownSeconds: 120
maxParallel: 1
mode: agent
autonomyPreset: apply_and_pr
enabled: true
---

A push just landed. Inspect the pushed commits, write missing tests for changed
behavior, run the focused suite then the repo suite, and if green open a draft
PR via `create_pull_request` from branch `mitii/cover-<shortsha>`.
Never push to main or master.
