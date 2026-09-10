---
name: release-changelog
title: Release changelog
description: Draft a Keep a Changelog entry from commits and diffs since the last tag or a given range.
intents: [docs, feature, bugfix, migrate]
routes: [direct_answer, execute]
tags: [git, changelog, release, semver, keep-a-changelog]
sizeClass: S
priority: 190
conflictGroup: ship-changelog
alwaysApply: false
enabled: true
when:
  - User asks for a changelog or release notes
  - Cutting a release / changelog recipe
instruction: Curate by user impact into Added/Changed/Fixed; emit only the changelog section. Do not tag or publish unless asked.
---

# Planning

Discover:
- Use commits/diff since last tag (or the provided range)
- Classify by consumer impact, not commit archaeology dumps

Change:
- Emit one version section with Added/Changed/Fixed (omit empty groups)
- Phrase entries for humans; group related bullets
- Final reply is ONLY the changelog markdown (no preface)

Verify:
- No secrets; no invented features
- Breaking changes called out under Changed with migration note when known

# Playbook

## Output template

```markdown
## [X.Y.Z] - YYYY-MM-DD
### Added
- …
### Changed
- …
### Fixed
- …
```

## Rules

- Changelog ≠ raw `git log`. Curate.
- If version/date unknown, use placeholders `[X.Y.Z]` and `YYYY-MM-DD`.
- Do not create tags or publish releases unless the user asked.
