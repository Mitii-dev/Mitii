# ADR: First-class Review module

**Status:** Accepted  
**Date:** 2026-09-14

## Context

Mitii already treats `review` as a diagnosis intent and ships the
`code-review-and-quality` skill. Verification’s `diff_review` check only
captures git status/diff as post-mutation evidence. Neither produces a
structured, coverage-guaranteed, line-anchored review artifact for IDE, CLI,
or CI consumers.

Open Code Review (Alibaba, Apache-2.0) demonstrates a deterministic
engineering × agent hybrid for code review: file selection, bundling,
path-matched rules, comment anchoring, and SARIF/CI posting. We will
**reimplement** those algorithms in TypeScript under Mitii contracts — we
will **not** vendor the Go CLI or drop in OCR prompts/`rule_docs`.

## Decision

1. Add a top-level V8 module `packages/v8/src/modules/review/` whose
   one-sentence outcome is: *Produce a structured, evidence-backed review
   artifact (findings + severity + coverage) for a diff/PR/seed without
   owning mutation or check execution.*
2. Keep V8 interaction modes as `ask | plan | agent`. Host UI `review`
   continues to map to engine `ask`. Review authority is diagnose/read
   plus a tightened tool grant and the Review pipeline.
3. Do not extend `verification` or rename `diff_review` into a judgment
   product. `ReviewRecord` is a separate durable artifact under
   `.mitii/review/`.
4. Attribution: algorithms inspired by [Open Code Review](https://github.com/alibaba/open-code-review)
   (Apache-2.0). Mitii owns all prompts, rule stubs, branding, and schemas
   (`mitii.review/v1`).

## Consequences

- Consumers: Agent Engine (review intent), CLI `mitii review`, VS Code
  review UI, automation/CI (SARIF + PR comments).
- Skills remain playbooks; structured output uses `emit_review_finding`.
- Architecture boundary tests and `ARCHITECTURE.md` §4 must list `review`.
- Post-review **mutation** is host-owned: VS Code **Fix / Fix all** compiles
  findings through `@mitii/host` `buildFixReviewFindingsAsk` into Agent mode
  with the `fix-review-findings` skill. The V8 review module never mutates.
