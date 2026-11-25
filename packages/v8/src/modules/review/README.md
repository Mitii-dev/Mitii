# Review

Produces structured, evidence-backed review findings for a diff, commit
range, workspace change set, or full-file scan. Does not own mutation or
post-mutation verification.

## Contract

**In:** `ReviewInput` (mode, files/diffs, effort, filters, rules).  
**Out:** `ReviewPreview` | `ReviewPrepResult` | `ReviewResult` (+ optional
`ReviewRecord` / SARIF).

| Facade | Stages |
|---|---|
| `preview` | 1-select-files |
| `prepare` | 1 → 2-group-files → 3-resolve-rules |
| `finalize` | 4-repair → 5-anchor → 6-reflect → 7-build-record |
| `toSarif` | 8-export-sarif |

Ports (injected): `ReviewRecordStorePort`, `ReviewLlmPort`, optional
`ModuleLoggerPort`. Diff discovery stays on the host via `ReviewDiffPort`.

## Example

```ts
import { ReviewPipeline, InMemoryReviewRecordStore } from "@mitii/v8/modules/review";

const pipeline = new ReviewPipeline({
  records: new InMemoryReviewRecordStore(),
});
const prep = pipeline.prepare(input);
const result = await pipeline.finalize({ input, prep, rawFindings });
```

## Non-responsibilities

Git shelling, model tool loops, mutation, verification `diff_review`
evidence. Bundled path rules live under `bundled-rules/`.
