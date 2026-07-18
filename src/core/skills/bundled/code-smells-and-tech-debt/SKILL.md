---
name: code-smells-and-tech-debt
description: >-
  Find and classify console logs, inline styles, missing type annotations, and targeted lint issues.
  Use for tech-debt cleanup, lint hygiene, console.log removal, and TypeScript typing gaps.
---

# Code Smells and Tech Debt

## Quick Reference

1. Run deterministic scripts first; inspect only files that matter.
2. Classify: **fix now** / **defer** / **ignore**.
3. Plan mode: report only. Act mode: scoped fixes after explicit cleanup ask or approval.
4. Keep mechanical cleanup separate from behavioral bug fixes.

## Steps

1. `execute_workspace_script({ script: "find-console-logs.sh" })`
2. `execute_workspace_script({ script: "find-inline-styles.sh" })`
3. `execute_workspace_script({ script: "check-missing-types.sh" })`
4. `execute_workspace_script({ script: "safe-lint-target.sh", args: ["<relative-file>"] })` after choosing touched files
5. Classify findings:
   - **fix now**: unsafe logs, obvious type holes, lint errors in touched files
   - **defer**: broad refactors, generated files, low-risk style outside scope
   - **ignore**: intentional diagnostics, examples, tests asserting console output

## Mode Rules

- Plan mode: report findings, risk, and proposed fix order only.
- Act mode: make scoped fixes after the task explicitly asks for cleanup or after the user approves the finding list.
- Keep behavioral changes separate from mechanical cleanup unless cleanup is required to fix the bug.
