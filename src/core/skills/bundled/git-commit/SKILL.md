---
name: git-commit
description: Use for explicitly requested local staging and committing.
---

# Git Commit

1. Inspect Git status.
2. Identify staged, unstaged, untracked, ignored, and conflicted files.
3. Detect secrets and generated files.
4. Stage only explicitly intended files.
5. Generate the commit message from the selected staged diff.
6. Create one commit after explicit approval.
7. Verify the resulting commit.
8. Report commit hash and included files.

Never use `git add .` without inspection. Never use `--no-verify` automatically. Never amend automatically. Never push automatically. Never commit secrets or unresolved conflicts.
