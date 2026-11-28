# Verification

The inspector: after a change, it runs the right trusted checks and says whether the work looks done.

## Does
- Maps changed files to projects from the pinned repository state.
- Discovers trusted checks from manifests, selects them under a cap, and executes them through a tool port.
- Normalizes diagnostics (new vs baseline), inspects the diff, and recommends completion.
- Captures and compares build state, builds records, and writes a user summary.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `VerificationInput` (`workspaceRoot`, `pinnedState`, `changedFiles`, `projects`, `verification` requirement, `grant`, optional baseline / `maxChecks` / `widenScope`).
**Output:** `VerificationResult` (checks run, diagnostics, completion recommendation, reason codes); optionally `RepoBuildState` or `VerificationRecord`.
**Pipeline:** `VerificationPipeline` stages: `1-map-affected-projects` → `2-discover-checks` → `3-select-checks` → `4-execute-checks` → `5-normalize-diagnostics` → `6-inspect-diff` → `7-recommend-completion`; plus `8-capture-build-state`, `9-build-record`, `10-build-user-summary`
**Ports we offer / need:** needs `VerificationToolExecutorPort` and `VerificationManifestReaderPort`; optional `VerificationRecordStorePort`, `VerificationSyntaxPort`, and `ModuleLoggerPort`. Adapters fulfill them (`InMemoryManifestReader`, `WorkspaceFileSystemManifestReader`, in-memory and file record stores).

## Dependencies
**Upstream (this module uses):** decision-policy (grant and verification requirement), repository-state (projects and pinned state).
**Downstream (who uses this):** planning (verify steps) and the engine (preflight build, start reuse, composition).

## How to use
```ts
import { VerificationPipeline, InMemoryManifestReader } from "@mitii/v8/modules/verification";

const pipeline = new VerificationPipeline({ tools, manifests: new InMemoryManifestReader({}) });
const result = await pipeline.verify(input);
```

## Example
Input (illustrative, abbreviated):
```json
{ "schemaVersion": 1, "workspaceRoot": "/repo", "changedFiles": ["src/auth.ts"], "changeScope": "localized", "maxChecks": 3 }
```
Output (illustrative, abbreviated):
```json
{ "checks": [{ "id": "typecheck", "status": "passed" }], "diagnostics": [], "recommendation": "complete" }
```

## Non-responsibilities
Does not run git, implement the tool runtime, grant authority (decision-policy), mutate files, or generate review findings.
