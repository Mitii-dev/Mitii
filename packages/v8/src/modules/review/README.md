# Review

The code reviewer's assistant: it prepares a review of changed code and cleans up the findings into trustworthy, anchored results.

## Does
- Previews and selects files from a diff, commit range, workspace change set, or full-file scan.
- Groups files and resolves review rules (bundled and user-configured).
- Repairs, anchors, and reflects raw findings, then builds a `ReviewRecord`.
- Exports SARIF and persists / loads records.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `ReviewInput` (mode, changed files with diffs, effort, filters, rules); `finalize` also takes the prep result and raw findings.
**Output:** `ReviewPreview`, `ReviewPrepResult`, or `ReviewResult` (plus optional `ReviewRecord` / SARIF report).
**Pipeline:** `ReviewPipeline` stages: `1-select-files` → `2-group-files` → `3-resolve-rules` (prepare); `4-repair-findings` → `5-anchor-findings` → `6-reflect-findings` → `7-build-record` (finalize); `8-export-sarif`, `9-format-prep`
**Ports we offer / need:** offers `ReviewRecordStorePort` (optional), `ReviewLlmPort` (optional), and `ReviewDiffPort` (implemented by the host to list changed files); optional `ModuleLoggerPort`. Adapters fulfill the store (`InMemoryReviewRecordStore`, `FileReviewRecordStore`).

## Dependencies
**Upstream (this module uses):** none.
**Downstream (who uses this):** the engine (review port, composition) and tool-runtime (emit-review-finding tool).

## How to use
```ts
import { ReviewPipeline, InMemoryReviewRecordStore } from "@mitii/v8/modules/review";

const pipeline = new ReviewPipeline({ records: new InMemoryReviewRecordStore() });
const prep = pipeline.prepare(input);
const result = await pipeline.finalize({ input, prep, rawFindings });
```

## Example
Input (illustrative, abbreviated):
```json
{ "mode": "workspace", "effort": "medium", "files": [{ "path": "src/auth.ts", "diff": "@@ … @@", "status": "modified" }] }
```
Output (illustrative, abbreviated):
```json
{ "status": "ok", "findings": [{ "path": "src/auth.ts", "line": 12, "severity": "warning", "message": "…" }] }
```

## Non-responsibilities
Does not run git, drive model tool loops, mutate files, or produce verification evidence.
