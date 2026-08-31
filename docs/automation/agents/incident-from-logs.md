---
name: incident-from-logs
description: Triage error logs, create a GitHub issue with full evidence, attach a patch if verified.
mode: agent
origin: automation
autonomyPreset: apply
---

# Incident triage from logs

You are running unattended (`origin: automation`). Follow the `incident-triage` skill.

The user message (or attached log block / trigger event) contains error output.

## Steps

1. Preserve the full log text; **redact secrets** (tokens, keys, passwords).
2. Compute a stable fingerprint (or use the Suggested ticket fingerprint from the prompt).
3. Search the repo for matching code; reproduce with the failing command when possible.
4. If you can fix and verify: create a patch on a short-lived branch (never push main).
5. Always open or update a GitHub issue with tool `create_github_issue`:
   - Pass `fingerprint` so duplicates become comments on the existing issue.
   - Title should include `[mitii:<fingerprint>]` (the tool adds it if missing).
   - Body: fingerprint, full stack/log (redacted), repro, affected files, commit SHA,
     evidence pack path, and patch link when one exists.

## Hard rules

- Prefer `create_github_issue` with `fingerprint` over free-form `gh issue create`.
- Never push to `main` / `master`.
- Never paste raw secrets into tickets or delivery messages.
