---
name: incident-triage
title: Incident Triage
description: Grab error logs, reproduce, fingerprint, draft tickets with full evidence, and attach patches when safe.
intents: [bugfix, diagnose, trace]
routes: [diagnose, execute]
tags: [incident, logs, triage, ticket, sentry, automation]
priority: 185
conflictGroup: debug
alwaysApply: false
enabled: true
when: [Error logs from CI or production, Sentry/Datadog alert, Need a ticket with full evidence, Unattended incident response]
instruction: Preserve full logs; fingerprint before filing; reproduce; ticket with all lines developers need; attach a patch only when the fix is verified.
---

# Planning

Discover:
- Capture the full error text, stack, timestamps, and environment
- Fingerprint the failure for dedupe (normalize paths/line noise)
- Locate matching code and recent related commits

Change:
- Reproduce with the smallest command
- Fix root cause only when autonomy allows apply
- Prepare a unified diff / patch file for attachment

Verify:
- Original failure is gone (or clearly still open)
- Ticket body includes logs, repro, files, and links
- No secrets in ticket or patch

# Playbook

# Incident Triage (Mitii automation)

## Overview

Structured unattended triage for CI and runtime errors. Evidence first, then
localize, then ticket. Patches are optional and only when verified.

## Evidence pack (always)

Include in the ticket / report:

1. **Fingerprint** — short stable id from error type + top frames
2. **Full error / log excerpt** — do not summarize away stack frames
3. **Failing command** — exact command and exit code
4. **Environment** — branch, commit SHA, OS/runtime if known
5. **Affected files** — paths and symbols
6. **Repro steps** — minimal
7. **Recent related commits** — `git log` / blame hints
8. **Suggested next action** — investigate / patch attached / needs human

## Flow

```
ingest logs → fingerprint → search code → reproduce
  ├── cannot reproduce → ticket (monitor) + all evidence
  ├── reproduced + autonomy readonly/propose → ticket + optional draft fix notes
  └── reproduced + autonomy apply* → fix → verify → ticket + patch (+ draft PR if asked)
```

## Ticket creation (Phase 0)

Prefer GitHub Issues via `gh`:

```bash
gh issue create --title "…" --body-file /tmp/mitii-incident.md
```

Attach the patch:

```bash
gh issue comment <n> --body "Patch attached." --body-file …
# or upload artifact in CI and link it
```

## Hard rules

- Never strip stack traces to “save tokens” in the ticket body; truncate only
  with an explicit marker and keep the full log as an artifact file.
- Redact secrets (tokens, cookies, private URLs with credentials).
- Do not open duplicate tickets for the same fingerprint in a short window;
  comment on the existing issue when possible.
- Do not claim fixed without re-running the failing command.
