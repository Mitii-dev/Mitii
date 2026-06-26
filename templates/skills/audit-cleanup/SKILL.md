---
name: audit-cleanup
description: Find unused imports, npm dependencies, and orphan source files. Use for cleanup, depcheck, dead code, or bundle-size audits.
---

# Audit / cleanup

## Steps

1. Read `package.json` and map `src/` with recursive `list_files`.
2. Run read-only checks:
   - `npx depcheck` (ignore build tooling false positives)
   - `rg` import searches per dependency and candidate orphan file
3. Classify each finding: **high** (safe), **medium** (likely), **low** (needs review).
4. In Plan mode: report only. In Act mode: remove after user confirms.

## Scripts

Optional helper (copy to `.thunder/skills/audit-cleanup/scripts/`):

```bash
#!/usr/bin/env bash
set -euo pipefail
npx depcheck --json 2>/dev/null || npx depcheck
```

Copy this skill to `.thunder/skills/audit-cleanup/` in your workspace.
