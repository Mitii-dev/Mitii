---
name: github-actions
description: >-
  Analyze GitHub Actions workflows and failures; update workflow files; dispatch or rerun runs.
  Use for CI workflow analysis, patches, and approved remote dispatch.
---

# GitHub Actions

## Quick Reference

- Analyze first; patch workflow files only when asked.
- Workflow **dispatch/rerun is a remote write** and needs explicit approval.
- Production/release workflow execution always requires approval.
- Check permissions, fork trust, secrets, and pinned action versions.

## Security Checks

- Excessive permissions / `pull_request_target`
- Untrusted fork execution
- Secret exposure and command interpolation
- Third-party action versions (prefer pinned SHAs)
- Production deployment, package publication, database migrations

## Workflow

1. Discover workflows and the failing run.
2. Analyze logs with bounded evidence.
3. Propose the smallest workflow or code fix.
4. For dispatch/rerun: confirm target, inputs, and environment, then request approval.
5. Verify the resulting run status.

## Tools

Prefer Mitii GitHub Actions tools: discover/analyze workflow, get run, dispatch — never invent credentials.
