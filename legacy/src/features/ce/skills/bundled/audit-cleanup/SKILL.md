---
name: audit-cleanup
description: >-
  Find unused imports, npm dependencies, and orphan source files.
  Use for cleanup, depcheck, dead code, knip, circular deps, or bundle-size audits.
---

# Audit / Cleanup — Script-First

## Quick Reference

1. Run workspace audit scripts before any manual grep or subagent.
2. Classify findings: **high** (safe), **medium** (likely), **low** (review).
3. Plan mode: report only. Act mode: remove only after user confirms.
4. Never spawn research agents to check dependencies one-by-one.

## Why Scripts

Checking dozens of dependencies via subagents causes many LLM rounds. Scripts use AST/dep tooling and finish in seconds.

## Steps

1. `execute_workspace_script({ script: "audit-dependencies.mjs" })` — depcheck
2. `execute_workspace_script({ script: "audit-dead-code.sh" })` — knip unused files/exports
3. `execute_workspace_script({ script: "check-circular-deps.mjs" })` — cycles
4. `execute_workspace_script({ script: "audit-package-engines.mjs" })` — engine drift
5. `read_file` `package.json` only if scripts are unavailable
6. Classify and propose a fix order
7. Act only after confirmation for removals

## Do Not

- `spawn_research_agent` / broad search to grep each dependency
- Delete packages without confirming they are unused at runtime and in docs/CI
