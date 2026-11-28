# Request Intake

The front desk: it turns whatever the host typed into one clean, trusted request envelope.

## Does
- Sanitizes the raw message.
- Recognizes slash commands (for example `/plan`) and flags meta commands that must short-circuit the agent path.
- Extracts `@path` mentions as referenced artifacts.
- Normalizes attachments and resolves the interaction mode.
- Builds the `UserRequestEnvelope`.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `CreateUserRequestInput` (`sessionId`, `mode`, `userMessage`, optional attachments / selection / `turnKind`).
**Output:** `RequestIntakeResult` — `envelope` (`UserRequestEnvelope`), `warnings`, `shortCircuitMeta`.
**Pipeline:** `RequestIntakePipeline` stages: `1-sanitize` → `2-classify-command` → `3-extract-mentions` → `4-normalize-attachments` → `5-resolve-mode` → `6-build-envelope`
**Ports we offer / need:** needs a clock port (`now()`) and an id-generator port (`generate(namespace)`); `ModuleLoggerPort` is optional. The host or tests supply the implementations.

## Dependencies
**Upstream (this module uses):** none.
**Downstream (who uses this):** request-understanding, decision-policy, repository-context, planning, skills, and the engine (which creates the envelope at the start of a turn).

## How to use
```ts
import { RequestIntakePipeline } from "@mitii/v8/modules/request-intake";

const intake = new RequestIntakePipeline({ clock, idGenerator });
const { envelope, shortCircuitMeta } = intake.intakeDetailed(input);
```

## Example
Input:
```json
{ "sessionId": "session-1", "mode": "agent", "userMessage": "/plan Fix @src/auth.ts" }
```
Output (illustrative, abbreviated):
```json
{
  "envelope": {
    "mode": "plan",
    "message": "Fix @src/auth.ts",
    "referencedArtifacts": [{ "path": "src/auth.ts" }]
  },
  "warnings": [],
  "shortCircuitMeta": false
}
```

## Non-responsibilities
Does not read file contents, call an LLM, store sessions, or decide intent — it only normalizes the request.
