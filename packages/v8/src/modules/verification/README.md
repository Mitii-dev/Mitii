# Verification

Verification gathers evidence after a change. It maps changed files to projects, discovers trusted checks, executes them through a verification tool port, normalizes diagnostics, and reports whether the change has enough evidence to complete.

## What This Module Does

- Validates verification input.
- Maps changed files to affected projects.
- Reads trusted manifests.
- Discovers applicable checks.
- Selects proportional checks for the change scope.
- Executes checks through `VerificationToolExecutorPort`.
- Normalizes diagnostics and compares against optional baseline diagnostics.
- Inspects diff/stale-state risk.
- Returns final verification status and evidence.
- Builds a durable `VerificationRecord` (before / after / comparison) that is stored outside the model transcript.
- Produces a deterministic user summary from that record. An optional engine LLM narrative may wrap it; it must not replace the counts.

## Structure

```text
verification/
  pipeline/                 VerificationPipeline
  actions/                  Check discovery, execution, diagnostics, records
  adapters/                 Manifest readers and verification-record stores
  contracts/
    input/                  VerificationInput
    output/                 VerificationResult, RepoBuildState, VerificationRecord
    ports/                  Tool, manifest, and record-store ports
    errors/                 VerificationErrors
  internal/
  tests/
```

## Types And Contracts

- `VerificationInput`: workspace root, pinned state, changed files, projects, verification requirement, grant, change scope, optional baseline diagnostics, and state readiness.
- `VerificationResult`: status, state token, affected project ids, checks, diagnostics, diff inspection, warnings, reason codes, and duration.
- `VerificationCheckResult`: command/check evidence with kind, project id, label, argv, source, outcome, exit code, duration, and summary.
- `VerificationDiagnostic`: path, severity, message, range, source/code/check id.
- `RepoBuildState` / `RepoBuildStateComparison`: before/after snapshots and the new / remaining / cleared delta.
- `VerificationRecord`: durable retry handle. Statuses: `captured_before`, `compared`, `passed`, `incomplete`, `cancelled`.
- `VerificationManifestReaderPort`: trusted manifest read contract.
- `VerificationToolExecutorPort`: command/check execution contract.
- `VerificationRecordStorePort`: save / load / loadLatest. Hosts persist under `.mitii/verification/`.

## Technical Details

- The public facade method is `VerificationPipeline.verify`.
- `buildRecord` / `persistRecord` / `loadLatestRecord` own the durable artifact. They are not prompt construction.
- Verification does not run arbitrary commands directly.
- Checks come from project descriptors and trusted manifests.
- Baseline diagnostics let the result focus on newly introduced issues.
- Unavailable repository state blocks verification unless policy allows unavailable evidence.
- Diff inspection reports changed paths and stale-state risk.
- A later "fix the remaining verification errors" turn reloads `loadLatest(workspaceId)` instead of scraping chat history.

## Ownership Boundaries

Owns verification planning, check execution, diagnostics, result evidence, and the durable verification record.

Does not own mutation, general tool authorization, repository indexing, prompt construction, or route policy. The Agent Engine decides when to persist, whether to keep edits, and when to ask the model for a short narrative.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/verification
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

VerificationInput -> VerificationResult:

```json
{
  "schemaVersion": 1,
  "workspaceRoot": "/repo",
  "pinnedState": { "workspaceId": "workspace-1", "stateToken": "state-abc" },
  "changedFiles": ["src/LoginForm.tsx", "src/LoginForm.test.tsx"],
  "projects": [
    {
      "projectId": "web",
      "rootId": "root",
      "name": "web",
      "kind": "node",
      "manifestPath": "package.json"
    }
  ],
  "verification": {
    "required": true,
    "minimumEvidence": ["tests_or_diagnostics"],
    "allowUnavailable": false
  },
  "grant": "decision.toolGrant",
  "changeScope": "localized",
  "stateReadiness": "ready"
}
```

### Step-By-Step Flow

1. A user sends the real prompt shown above from an editor or chat host.
2. Agent Engine records that mutation tools changed `src/LoginForm.tsx`.
3. Agent Engine also records that `src/LoginForm.test.tsx` changed because the focused test was updated.
4. Decision Policy has already required verification for this write route.
5. Verification validates the pinned repository state and changed-file list.
6. Verification maps both changed files to the `web` project from Repository State.
7. Verification reads trusted manifests through `VerificationManifestReaderPort`.
8. Verification discovers a focused test command or a project diagnostics command.
9. Verification selects proportional checks because the change scope is localized.
10. Verification executes the selected check through `VerificationToolExecutorPort`.
11. Verification normalizes diagnostics and compares them with any baseline diagnostics.
12. Verification inspects the diff and reports stale-state risk.
13. Verification returns the realistic output shape shown below.
14. Agent Engine uses this result to decide whether the run can complete.

### Realistic Output

Verification returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "passed",
  "stateToken": "state-abc",
  "affectedProjectIds": ["web"],
  "checks": [
    {
      "checkId": "web:test-loginform",
      "kind": "test",
      "projectId": "web",
      "label": "LoginForm focused test",
      "argv": ["pnpm", "test", "src/LoginForm.test.tsx"],
      "evidenceSource": "package.json",
      "outcome": "passed",
      "exitCode": 0,
      "durationMs": 1842,
      "summary": "LoginForm pending-state test passed.",
      "toolCallId": "verify-1"
    }
  ],
  "diagnostics": [],
  "diff": {
    "reviewed": true,
    "staleStateRisk": false,
    "summary": "Changed LoginForm pending button state and updated focused test.",
    "changedPaths": ["src/LoginForm.tsx", "src/LoginForm.test.tsx"]
  },
  "warnings": [],
  "reasonCodes": ["verification_passed"],
  "durationMs": 1910
}
```
