# Request Intake

Request Intake is the first V8 module a user request passes through. It validates raw host input and creates a normalized `UserRequestEnvelope` that downstream modules can trust.

## What This Module Does

- Validates the incoming request shape.
- Requires meaningful content through a message or referenced artifacts.
- Normalizes mode, origin, workspace scope, referenced artifacts, and correlation metadata.
- Assigns request ids and timestamps through injected ports.
- Produces the stable envelope consumed by Request Understanding and Decision Policy.

## Structure

```text
request-intake/
  pipeline/                 RequestIntakePipeline
  contracts/
    input/                  CreateUserRequestInput
  request-envelope/         UserRequestEnvelopeBuilder and envelope types
  interaction-mode/         AgentMode schema and constants
  tests/                    Pipeline and envelope tests
```

## Types And Contracts

- `CreateUserRequestInput`: boundary input with `sessionId`, `mode`, `userMessage`, optional `requestId`, `origin`, `referencedArtifacts`, `workspace`, and `correlation`.
- `UserRequestEnvelope`: normalized output with `schemaVersion`, `requestId`, `sessionId`, `mode`, `origin`, `message`, artifact list, optional workspace/correlation, and `createdAt`.
- `AgentMode`: request mode used by later policy and planning modules.
- `RequestArtifactReference`: file/folder/attachment/selection/symbol reference metadata.
- `RequestEnvelopeClockPort`: injected clock for deterministic timestamps.
- `RequestEnvelopeIdGeneratorPort`: injected id generator.

## Technical Details

- The public facade method is `RequestIntakePipeline.intake`.
- The schema rejects empty requests unless artifacts provide content.
- Message length and artifact count limits are enforced before any model or repository work.
- The module records observed workspace state if the host provides it, but it does not resolve or validate repository artifacts.

## Ownership Boundaries

Owns request validation and envelope creation.

Does not own intent classification, route decisions, repository indexing, prompt construction, model calls, or tool execution.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/request-intake
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

CreateUserRequestInput -> UserRequestEnvelope:

```json
{
  "sessionId": "session-1",
  "mode": "agent",
  "userMessage": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "referencedArtifacts": [
    { "kind": "file", "name": "LoginForm.tsx", "path": "src/LoginForm.tsx" }
  ],
  "workspace": { "workspaceId": "workspace-1" }
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

Request Intake envelope creation returns a result like this:

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
