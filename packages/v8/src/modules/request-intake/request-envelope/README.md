# Request Envelope

Request Envelope is the normalized request object created by Request Intake. It gives every downstream module the same request identity, message, mode, artifacts, workspace scope, correlation metadata, and timestamp.

## What This Component Does

- Builds `UserRequestEnvelope` values from validated intake input.
- Fills default origin when missing.
- Generates a request id when the host does not supply one.
- Stamps `createdAt` using the injected clock.
- Preserves referenced artifacts and workspace observations.

## Structure

```text
request-envelope/
  UserRequestEnvelopeBuilder.ts
  constants.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `UserRequestEnvelope`: the normalized request.
- `UserRequestOrigin`: `user`, `automation`, or `api`.
- `RequestArtifactReference`: artifact id/name/path/kind/language/range metadata.
- `UserRequestWorkspaceScope`: workspace id, root ids, and optional observed snapshot/index tokens.
- `UserRequestCorrelation`: trace/client request ids.
- `UserRequestEnvelopeBuilderDependencies`: clock and id generator ports.

## Technical Details

- This layer assumes input has already passed `createUserRequestInputSchema`.
- Artifact references remain metadata only; file contents are not loaded here.
- Workspace observations are carried forward for policy/context decisions but are not resolved here.

## Ownership Boundaries

Owns the request envelope value object and builder.

Does not own task analysis, repository state, grants, prompt text, or tool execution.

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

validated intake object -> UserRequestEnvelope:

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

Request Envelope builder returns a result like this:

```json
{
  "schemaVersion": 1,
  "requestId": "req-1",
  "sessionId": "session-1",
  "mode": "agent",
  "origin": "user",
  "message": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "referencedArtifacts": [],
  "workspace": { "workspaceId": "workspace-1" },
  "createdAt": "2026-08-14T12:00:00.000Z"
}
```
