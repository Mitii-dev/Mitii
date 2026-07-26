---
name: github-pull-request
description: >-
  Draft or create GitHub pull requests using the repository PR template.
  Use for PR drafts (read-only) and approved PR creation — not merge unless asked.
---

# GitHub Pull Request

## Quick Reference

- Drafting is read-only; creating is a remote write requiring approval.
- Verify repo, base/head, existing PR, ahead commits, and that the branch is pushed.
- Generate a reviewer-useful title/body from commits, diff summary, key code changes, and the repository PR template.
- Show the final title and body before remote creation.
- Create exactly one PR; return number and URL.
- Do not merge, add reviewers, add labels, or edit milestones unless requested.

## PR Draft Workflow

1. Verify the current branch, default/base branch, remote, and repository host.
2. Refuse PR creation from `main`/`master` unless the user explicitly confirms that is intended.
3. Check for an existing PR for the same head branch.
4. Gather commits ahead of the base branch, a diff stat, and targeted code diffs for the most important files.
5. Read the repository PR template if one exists.
6. Draft a body that explains what changed, why it matters, and how to test it.
7. Keep file-by-file detail out unless it helps reviewers understand risk.

## PR Body Structure

Prefer this structure unless the repository template says otherwise:

```markdown
## Summary
[One or two sentences covering the change and value]

## Changes
- [Reviewer-relevant behavior or implementation change]

## Testing
- [Command or manual verification performed]

## Notes
[Risks, limitations, follow-ups, or related issues when relevant]
```

## Creation Checklist

1. Confirm the branch is pushed or push only after user approval.
2. Show final title/body.
3. Create the PR with GitHub tooling after approval.
4. Return the PR number, URL, base, head, and any verification that was not run.
