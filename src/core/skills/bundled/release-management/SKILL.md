---
name: release-management
description: Use for staged release preparation, version updates, changelog updates, release commits, tags, pushes, and GitHub releases.
---

# Release Management

Support staged release preparation:

1. Inspect repository.
2. Determine version.
3. Update version files.
4. Update changelog.
5. Run configured validation.
6. Commit release changes.
7. Create tag.
8. Push branch and tag.
9. Create GitHub release.

Do not execute the entire release as one unrestricted loop. Each local or remote write stage must be separately verified.
