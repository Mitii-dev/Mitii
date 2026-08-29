# Request Understanding

Request Understanding converts a normalized `UserRequestEnvelope` into structured task evidence. It tells policy and planning what the user appears to want, but it does not grant authority.

## What This Module Does

- Extracts the primary user message from the envelope.
- Classifies task and interaction intent.
- Resolves a Super Intent result with confidence and clarification signals.
- Runs Task Analyzer to derive scope, complexity, risk, clarity, targets, constraints, and requested outcomes.
- Recommends whether repository discovery, planning, verification, or clarification may be needed.

## Structure

```text
request-understanding/
  pipeline/                 RequestUnderstandingPipeline
  contracts/
    input/                  RequestUnderstandingPipelineInput
    output/                 RequestUnderstandingResult
  intent/                   Intent router, rule/LLM classifiers, resolution
  task-analyzer/            Dimension extraction and task analysis contracts
  tests/                    Pipeline, intent, and target extraction tests
```

## Types And Contracts

- `RequestUnderstandingPipelineInput`: the `UserRequestEnvelope`.
- `RequestUnderstandingResult`: `{ intent, taskAnalysis }`.
- `intent`: Super Intent result with status, classification, scores, confidence margin, clarification recommendation, and diagnostics.
- `TaskAnalysis`: scope, complexity, risk, clarity, targets, constraints, requested outcomes, recommendations, estimated file impact, signals, and confidence.

## Technical Details

- The public facade method is `RequestUnderstandingPipeline.understand`.
- Rule classifiers provide deterministic intent signals.
- Optional LLM classification can enrich the intent result.
- Task analysis focuses on dimensions, not hard-coded task templates.
- Recommendations are advisory; Decision Policy decides route and grants.

## Ownership Boundaries

Owns intent and task evidence.

Does not own repository retrieval, prompt construction, tool grants, tool execution, or verification.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/request-understanding
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

UserRequestEnvelope -> RequestUnderstandingResult:

```json
{
  "schemaVersion": 1,
  "requestId": "req-1",
  "sessionId": "session-1",
  "mode": "agent",
  "origin": "user",
  "message": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "referencedArtifacts": [
    { "kind": "file", "name": "LoginForm.tsx", "path": "src/LoginForm.tsx" }
  ],
  "workspace": { "workspaceId": "workspace-1" },
  "createdAt": "2026-08-14T12:00:00.000Z"
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

Request Understanding result returns a result like this:

```json
{
  "intent": {
    "status": "accepted",
    "classification": {
      "primaryTaskIntent": "implementation",
      "interactionIntent": "execute"
    },
    "confidenceMargin": 0.42,
    "recommendsClarification": false
  },
  "taskAnalysis": {
    "scope": "single_location",
    "complexity": "simple",
    "risk": "low",
    "clarity": "clear",
    "targets": [{ "kind": "file", "value": "src/LoginForm.tsx", "explicit": true }],
    "requestedOutcomes": ["disable button while login request is pending", "show loading label"],
    "recommendsRepositoryDiscovery": true,
    "recommendsPlanning": false,
    "recommendsVerification": true,
    "confidence": 0.86
  }
}
```
