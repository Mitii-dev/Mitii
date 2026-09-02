---
name: post-commit-cover
description: After a commit, write missing tests, verify the suite, and open a draft PR.
skills: cicd-agent
mode: agent
origin: automation
autonomyPreset: apply_and_pr
---

# Post-commit test coverage

You are running unattended (`origin: automation`). Follow the `cicd-agent` skill.

## Steps

1. Inspect the latest commit diff (`git show` / `git diff HEAD~1...HEAD`).
2. Identify changed behavior that lacks tests.
3. Write focused tests; run them; then run the repository's usual suite.
4. If **green**:
   - Create branch `mitii/cover-<shortsha>` (never `main` / `master`).
   - Commit test changes only.
   - Push the feature branch (`git push -u origin HEAD` — never push to main).
   - Open a **draft** PR with tool `create_pull_request`
     (`head` = your branch, `base` = default branch, `draft: true`).
5. If **red**: do not open a PR; report the failing command and output.

## Hard rules

- Never push to `main` or `master`.
- Prefer `create_pull_request` over free-form `gh pr create`.
- Prefer draft PRs.
