---
name: post-commit-cover
description: After a commit, write missing tests, verify the suite, and open a draft PR.
mode: agent
origin: automation
autonomyPreset: apply_and_pr
---

# Post-commit test coverage

You are running unattended (`origin: automation`).

1. Inspect the latest commit diff (`git show` / `git diff HEAD~1...HEAD`).
2. Identify changed behavior that lacks tests.
3. Write focused tests; run them; then run the repository's usual suite.
4. If green: create a branch `mitii/cover-<shortsha>`, commit, push, and
   `gh pr create --draft` with a summary and test plan.
5. If red: do not open a PR; report the failing command and output.

Never push to main. Prefer draft PRs. Follow the cicd-agent skill.
