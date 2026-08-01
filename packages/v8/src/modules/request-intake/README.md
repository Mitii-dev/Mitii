# Request Intake

```text
Input:  CreateUserRequestInput (mode + message + optional artifacts)
Output: UserRequestEnvelope
```

Normalizes raw host requests into a validated envelope. Interaction mode and
envelope construction live behind one primary facade.

## Public pipeline

| Export | Role |
|--------|------|
| `RequestIntakePipeline` | Primary facade (`intake`) |
| `UserRequestEnvelopeBuilder` | Envelope builder used by the facade |
| `agentModeSchema` / `AgentMode` | Interaction mode contract |
| `userRequestEnvelopeSchema` / `UserRequestEnvelope` | Envelope contract |

```ts
const intake = new RequestIntakePipeline({ clock, idGenerator });
const envelope = intake.intake({
  sessionId: "session-1",
  mode: "agent",
  userMessage: "Fix the selected file.",
});
```

## Flow

```text
CreateUserRequestInput
  → validate AgentMode
  → UserRequestEnvelopeBuilder.build()
  → UserRequestEnvelope
```

## Do not put here

- Intent classification or task analysis (`request-understanding`)
- LLM / model calls of any size (including quick classification)
- Decision policy, routing, or tool grants
- Repository indexing or context retrieval

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/request-intake
```
