# Planning

Planning creates structured plans when policy or user mode calls for visible planning. It turns task evidence into a `PlanArtifact` with phases, steps, context references, risks, alternatives, and verification guidance.

## What This Module Does

- Validates `PlanningInput`.
- Blocks planning when `planningDepth` is `none`.
- Drafts a generic structured plan from task dimensions.
- Incorporates optional skill hints, process hints, reviewed context, and prior plans.
- Validates required plan sections.
- Compacts the plan to a token budget.
- Serializes plan artifacts for user answers or prompt injection.

## Structure

```text
planning/
  pipeline/                 PlanningPipeline
  actions/                  Draft, validate, compact, serialize, format
  contracts/
    input/                  PlanningInput
    output/                 PlanArtifact, PlanningResult
    errors/                 PlanningErrors
  tests/
```

## Types And Contracts

- `PlanningInput`: query, mode, route, planning depth, task evidence, optional skills, process hints, reviewed context, prior plan, and budget.
- `PlanningTaskEvidence`: primary/secondary intent, scope, complexity, risk, clarity, targets, constraints, outcomes, recommendations, and change impact hints.
- `PlanArtifact`: structured plan with dimensions, phases, steps, risks, alternatives, and verification.
- `PlanningResult`: status, optional plan, warnings, reason codes, used budget, total budget, and duration.

## Technical Details

- The public facade method is `PlanningPipeline.plan`.
- Planning is dimension-driven rather than task-template driven.
- Skill hints are optional and must not become hard-coded plan switches.
- `priorPlan` supports validation or revision.
- `formatPlanAsAnswer`, `serializePlanForPrompt`, and `serializePlanText` produce safe text from structured plans.

## Ownership Boundaries

Owns structured plan creation and serialization.

Does not own plan approval UI, tool execution, route authority, task-list persistence, or verification execution.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/planning
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

PlanningInput -> PlanningResult:

```json
{
  "prompt": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "workspaceId": "workspace-1",
  "stateToken": "state-abc",
  "targetFile": "src/LoginForm.tsx"
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

Planning result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "validated",
  "plan": {
    "schemaVersion": 1,
    "title": "Add LoginForm pending state",
    "phases": [
      { "id": "inspect", "title": "Inspect current LoginForm behavior", "steps": [{ "id": "inspect-login", "title": "Read src/LoginForm.tsx", "risk": "low" }] },
      { "id": "change", "title": "Implement pending UI", "steps": [{ "id": "add-loading", "title": "Disable Sign in button while submit is pending", "risk": "low" }] },
      { "id": "verify", "title": "Verify behavior", "steps": [{ "id": "verify-login", "title": "Run or update LoginForm test", "risk": "low" }] }
    ]
  },
  "reasonCodes": ["plan_drafted"],
  "usedTokens": 420,
  "budgetTokens": 1600
}
```
