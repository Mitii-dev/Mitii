# Decision Policy

Decision Policy is V8's authority module. It converts request evidence into one `ExecutionDecision` that tells the rest of the system what route to take, whether planning is required, what tools may run, how approvals work, and what verification evidence is required.

## What This Module Does

- Resolves execution route and run disposition.
- Applies hard caps from interaction mode.
- Decides planning depth and plan gate.
- Decides whether repository context is required.
- Compiles `ToolGrant` with allowed tools, effects, paths, command/network rules, limits, approval mode, mutation budget, and optional mutation path scopes.
- Scans prompt-injection signals and clamps authority when needed.
- Builds verification requirements.
- Produces a trace for audit/debugging.

## Structure

```text
decision-policy/
  pipeline/                 DecisionPolicyPipeline
  contracts/
    input/                  DecisionPolicyInput
    output/                 ExecutionDecision, ToolGrant
    errors/                 DecisionPolicyErrors
  actions/                  Route, grant, verification, mutation, injection decisions
  constants.ts
  policy.ts
  patterns.ts
  tests/
```

## Types And Contracts

- `DecisionPolicyInput`: envelope, understanding, optional repository-state summary, approval mode, plan approval mode, host capability flags, and optional `windowPolicy` from Window Budget. When `windowPolicy` is omitted, visible-plan and change-impact affordances stay on (large-window behavior). When present, planning depth and mutation batch size follow the derived usable-input / output reserves.
- `ExecutionDecision`: route, planning depth, plan gate, run disposition, repository-context requirement, optional pinned state, tool grant, verification requirement, reason codes, warnings, rationale, and optional trace.
- `ToolGrant`: maximum workspace effect, allowed tools/effects, path scopes, optional mutation path scopes, command rules, network hosts, approval mode, limits, and optional mutation budget.
- `MutationBudget`: per-call patch limits and preferred batching hints.
- `DecisionTrace`: route priority step, grant profile, mutation profile, injection clamp, and signals used.

## Technical Details

- Ask and plan modes cannot receive write grants.
- Injection scanning never broadens authority.
- `narrow()` may reduce scope or tighten approval/budgets after discovery; it cannot add authority.
- `narrow()` returns the previous decision when the grant is unchanged.
  Callers MUST emit `grant_narrowed` only when `toolGrantsEquivalent` is false.
- Mutation profiles are `relaxed`, `standard`, and `tight`. When `windowPolicy` is present, each numeric cap is `min(profile, window)` and `requireBatchedExecution` is OR'd.
- Write grants may set `mutationPathScopes` from explicit folder/file targets. Discovery tools keep `pathScopes: ["."]` for package / multi-file work so `glob_files` / `search_files` can still see the repo; `apply_patch` / delete / move enforce `mutationPathScopes`.
- `narrow()` also narrows `mutationPathScopes` when they were set.
- Verification requirements specify required evidence and whether unavailable evidence is acceptable.
- Host capability flags currently include web search availability.

## Ownership Boundaries

Owns route authority, grant compilation, approval mode, mutation budgets, repository-context need, and verification requirement.

Does not own classification, model prompts, tool execution, repository indexing, checkpointing, or UI.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/decision-policy
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

DecisionPolicyInput -> ExecutionDecision:

```json
{
  "schemaVersion": 1,
  "envelope": "UserRequestEnvelope from Request Intake",
  "understanding": "RequestUnderstandingResult from Request Understanding",
  "repositoryState": {
    "reference": { "workspaceId": "workspace-1", "stateToken": "state-abc" },
    "readiness": "ready"
  },
  "hostCapabilities": { "webSearch": false }
}
```

### Step-By-Step Flow

1. A user sends the real prompt shown above from an editor or chat host.
2. The host attaches workspace id `workspace-1` and the explicit target file `src/LoginForm.tsx`.
3. The module receives the real structure shown in the input block.
4. The module validates schema/version/limits before doing any work.
5. The module extracts the important target: `src/LoginForm.tsx`.
6. The module keeps the user constraint: existing validation and error handling must stay intact.
7. The module performs only its own responsibility and does not cross into neighboring modules.
8. Any budget, path, state, or provider constraint is applied before output is produced.
9. The module records warnings/reason codes instead of hiding degraded behavior.
10. The module returns the realistic output shape shown below.
11. The next pipeline stage consumes that output without reinterpreting raw user text.

### Realistic Output

Decision Policy execution decision returns a result like this:

```json
{
  "schemaVersion": 1,
  "route": "execute",
  "planningDepth": "none",
  "planGate": "not_required",
  "runDisposition": "continue",
  "repositoryContextRequired": true,
  "pinnedState": { "workspaceId": "workspace-1", "stateToken": "state-abc" },
  "toolGrant": {
    "maximumWorkspaceEffect": "write",
    "allowedTools": ["read_file", "search", "apply_patch", "shell"],
    "allowedEffects": ["read", "write", "execute"],
    "pathScopes": ["."],
    "approvalMode": "on_request",
    "limits": { "maxToolCalls": 20, "maxWallTimeMs": 120000, "maxOutputBytes": 256000 },
    "mutationBudget": { "maxPatchesPerCall": 6, "maxUniqueFilesPerCall": 3, "maxPatchPayloadCharacters": 24000, "preferredBatchSize": 2, "requireBatchedExecution": false }
  },
  "verification": { "required": true, "minimumEvidence": ["tests_or_diagnostics"], "allowUnavailable": false },
  "reasonCodes": ["execute_requested", "localized_change", "verification_required"]
}
```
