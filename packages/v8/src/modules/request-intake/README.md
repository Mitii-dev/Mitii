# Request Intake

**Does:** raw host request → trusted `UserRequestEnvelope` (sanitize, slash commands, `@path` mentions, attachments, mode). No LLM, file reads, or session storage.

## Contract

```text
CreateUserRequestInput  →  RequestIntakePipeline.intakeDetailed()  →  {
  envelope: UserRequestEnvelope,
  warnings: string[],
  shortCircuitMeta: boolean,
}
```

Host should pre-fill selection / picker artifacts, attachments, and `turnKind` when known.

## Example

```ts
const { envelope, shortCircuitMeta } = new RequestIntakePipeline({
  clock,
  idGenerator,
}).intakeDetailed({
  sessionId: "session-1",
  mode: "agent",
  userMessage: "/plan Fix @src/auth.ts",
});

// envelope.mode === "plan"
// envelope.referencedArtifacts includes src/auth.ts
// shortCircuitMeta === false  (/plan enters an agent turn)
```
