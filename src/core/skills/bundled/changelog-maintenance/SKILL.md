---
name: changelog-maintenance
description: >-
  Create or update release notes and CHANGELOG files.
  Use only when the user asks for changelog or release-notes work.
---

# Changelog Maintenance

## Quick Reference

1. Locate the canonical changelog and detect its format.
2. Resolve the correct tag/commit range.
3. Aggregate user-facing changes; exclude internal noise.
4. Preserve historical entries; apply the smallest patch.
5. Validate Markdown and version ordering.

## Workflow

1. Locate the canonical changelog (`CHANGELOG.md`, `CHANGES.md`, Changesets, Release Please, etc.).
2. Detect format: Keep a Changelog, Conventional Changelog, Changesets, Release Please, or custom.
3. Resolve the tag or commit range for new entries.
4. Aggregate changes deterministically (prefer Mitii changelog tools when available).
5. Group user-facing changes; exclude chore/ci/internal noise unless requested.
6. Preserve historical entries — never rewrite old releases unless asked.
7. Apply the smallest patch.
8. Validate Markdown structure and version ordering.

## Safety

- Do not invent release versions.
- Do not commit or push unless the user asked for a release/commit stage.
