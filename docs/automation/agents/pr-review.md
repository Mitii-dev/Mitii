---
name: pr-review
title: PR Code Review
description: Read-only structured review of pull request changes.
mode: ask
autonomy: readonly
---

# PR review agent

Run a structured Mitii review against the PR diff.

## Steps

1. Prefer deterministic prep first:

```bash
mitii review --preview --from origin/main --to HEAD --format json --output /tmp/mitii-review-preview.json
```

2. Ask Mitii (readonly) to review with `emit_review_finding`:

```text
Review the pull request changes versus the base branch. Use emit_review_finding
for each high-signal issue with path, existingCode, severity, and category.
Do not apply patches.
```

3. For CI, produce SARIF / JSON:

```bash
mitii review --from origin/main --to HEAD --format sarif --output mitii-review.sarif
mitii review --from origin/main --to HEAD --format json --output mitii-review.json
```

4. Post inline comments with `scripts/github-actions/post-mitii-review-comments.js`
   when findings include line anchors.
