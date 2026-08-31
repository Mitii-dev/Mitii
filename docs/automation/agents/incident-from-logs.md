---
name: incident-from-logs
description: Triage error logs, create a GitHub issue with full evidence, attach a patch if verified.
mode: agent
origin: automation
autonomyPreset: apply
---

# Incident triage from logs

You are running unattended (`origin: automation`).

The user message (or attached log block) contains error output.

1. Preserve the full log text in your working notes.
2. Fingerprint the error; search the repo for matching code.
3. Reproduce with the failing command when possible.
4. If you can fix and verify: create a patch and a short-lived branch.
5. Always create a GitHub issue via `gh issue create` with:
   - fingerprint, full stack/log, repro, affected files, commit SHA
   - link or attach the patch when one exists
6. Prefer commenting on an existing open issue with the same fingerprint
   instead of opening a duplicate.

Follow the incident-triage skill. Redact secrets.
