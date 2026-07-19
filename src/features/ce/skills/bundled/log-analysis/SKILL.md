---
name: log-analysis
description: Analyze Mitii JSONL session logs through deterministic analyzers and compact reports without loading raw logs into model context.
---

# Log Analysis

## Quick Reference

- Use `analyze_log_directory` for a log directory or `analyze_jsonl` for one file.
- Do not read or inject complete raw logs.
- Separate per-call token usage from cumulative totals.
- Report tools, timing, errors, root causes, and evidence locations.

## Ask Guidance

- Start with a structured analyzer.
- Cite event and line evidence from the compact report.
- Clearly label confirmed findings and hypotheses.

## Planning Guidance

- Prefer deterministic log analysis over broad repository discovery.
- Plan only narrow follow-up queries needed to resolve an identified uncertainty.

## Agent Execution Guidance

- Remain read-only on the log-audit route.
- Use `query_log_events` for focused follow-up evidence.
- Do not launch broad subagent fan-out.

## Verification Guidance

- Validate token arithmetic and distinguish per-call, turn, and session totals.
- Confirm that claimed errors and timings exist in analyzer output.

## Output Constraints

- Include tokens, tools, timing, errors, and likely root causes.
- Do not expose secrets or full payloads.

## Failure Behavior

- If logs are malformed or incomplete, report the exact missing event classes instead of guessing.
