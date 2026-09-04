---
name: morning-health
cron: "0 9 * * MON-FRI"
timezone: America/Chicago
mode: ask
autonomyPreset: readonly
enabled: true
---

Summarize repository health for this workspace:

1. List dirty git status briefly
2. Note any failing tests if a standard test script is obvious
3. Reply with a short markdown report only — do not edit files
