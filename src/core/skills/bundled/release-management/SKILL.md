---
name: release-management
description: >-
  Staged release preparation: version bumps, changelog, release commits, tags, pushes, and GitHub releases.
  Use for releases — each write stage must be separately verified and approved.
---

# Release Management

## Quick Reference

1. Inspect repo → determine version → update version files → update changelog.
2. Run configured validation.
3. Commit release changes → create tag → push → create GitHub release.
4. **Do not** run the entire release as one unrestricted loop.
5. Each local or remote write stage needs separate verification and approval.

## Staged Workflow

1. Inspect repository state and existing release tooling.
2. Determine the next version from policy/history.
3. Update version files.
4. Update changelog (`changelog-maintenance` patterns).
5. Run configured validation (tests/build).
6. Commit release changes (`git-commit`).
7. Create tag.
8. Push branch and tag (explicit approval).
9. Create GitHub release (always_explicit for production).

## Safety

Fail closed on ambiguous version, dirty tree, or failing validation. Prefer Mitii release/changelog tools over ad-hoc shell.
