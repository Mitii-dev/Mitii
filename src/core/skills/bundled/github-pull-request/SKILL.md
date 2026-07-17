---
name: github-pull-request
description: >-
  Draft or create GitHub pull requests using the repository PR template.
  Use for PR drafts (read-only) and approved PR creation — not merge unless asked.
---

# GitHub Pull Request

## Quick Reference

- Drafting is read-only; creating is a remote write requiring approval.
- Verify repo, base/head, existing PR, and that the branch is pushed.
- Use the repository PR template; show final title/body before create.
- Create exactly one PR; return number and URL.
- Do not merge, add reviewers, or add labels unless requested.

## PR Creation Checklist

1. Verify repository.
2. Verify base and head branches.
3. Detect an existing PR for the same head.
4. Verify the branch is pushed.
5. Use the repository PR template.
6. Show final title and body.
7. Create exactly one PR after approval.
8. Return the PR number and URL.
