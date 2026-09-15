# Review

Review produces a structured, evidence-backed review artifact (findings +
severity + coverage) for a diff, commit range, workspace change set, or full
file scan. It does **not** own mutation or post-mutation verification checks.

Algorithms are inspired by [Open Code Review](https://github.com/alibaba/open-code-review)
(Apache-2.0) and reimplemented under Mitii contracts. See
`docs/architecture/ADR-review-module.md`.

## What This Module Does

- Validates review input (workspace / range / commit / scan).
- Deterministically selects reviewable files with exclude reasons.
- Groups files for bounded concurrent review.
- Resolves path-matched review rules (workspace → system → bundled).
- Repairs, anchors, and optionally reflects model findings.
- Builds a durable `ReviewRecord` and can export SARIF 2.1.0.

## Structure

```text
review/
  pipeline/                 ReviewPipeline (preview | prepare | finalize)
  actions/                  Select, group, rules, anchor, repair, reflect, record, SARIF
  contracts/                Input / output / errors / ports
  adapters/                 In-memory and file record stores
  bundled-rules/            Mitii-owned default path rules
  internal/                 Path utils, scan batching
  tests/
```

## Ownership Boundaries

Owns selection, grouping, rules resolution, finding post-process, review
records, and SARIF export.

Does not own git shelling, model tool loops, mutation, or verification
`diff_review` evidence. Hosts inject `ReviewDiffPort` / LLM / store ports.

## Public Facade

- `preview(input)` — same selection as prepare; no LLM.
- `prepare(input)` — selection + groups + rules (delegate-equivalent).
- `finalize({ input, rawFindings | findings, prep? })` — anchor/repair/reflect/record.
- `toSarif(result)` / `loadLatest(workspaceId)` / `persistRecord`.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/review
```
