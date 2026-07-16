---
name: github-actions
description: Use for GitHub Actions workflow analysis, failure analysis, workflow file updates, dispatch, and reruns.
---

# GitHub Actions

Workflow dispatch is a remote write.

Security checks:

- Excessive permissions
- `pull_request_target`
- Untrusted fork execution
- Secret exposure
- Command interpolation
- Third-party action versions
- Production deployment
- Package publication
- Database migrations

Production or release workflow execution must always require approval.
