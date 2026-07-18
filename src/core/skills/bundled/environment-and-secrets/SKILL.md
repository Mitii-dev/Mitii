---
name: environment-and-secrets
description: >-
  Safely inspect env templates, missing keys, and secret setup without exposing values.
  Use for .env, env.example, missing variables, API keys, tokens, and secret configuration.
---

# Environment and Secrets

## Quick Reference

- Report **key names and paths only** — never secret values.
- Prefer `sync-env-files.mjs` before reading env files manually.
- Update examples/validation/docs with placeholders, not real credentials.
- If a secret is already in tracked files, stop and report it as a security concern.

## Steps

1. `execute_workspace_script({ script: "sync-env-files.mjs" })` — compare `.env*` with templates
2. Read `.env.example`, `.env.template`, or documented config only when the script points there
3. Report missing keys by name, grouped by file
4. Guide the user to fill local `.env` from committed examples
5. If code changes are needed, update validation/docs/examples with placeholders such as `YOUR_API_KEY_HERE`

## Safety Rules

- Never print, summarize, or transform secret values.
- Never copy values from `.env` into docs, tests, logs, prompts, or generated files.
- Prefer placeholders over real credentials in any write.
