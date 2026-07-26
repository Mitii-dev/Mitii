# Agent Engine

```text
Input:  AgentEngineStartInput { request, workspaceRoot?, repositoryState?, budget? }
Output: AgentRunHandle { runId, events, result, cancel }
```

Coordinates public V8 facades through one cancellable read-only run.
Does not implement intent classification, indexing, retrieval, prompting,
tool enforcement, or verification algorithms.

## Public API

| Export | Role |
|--------|------|
| `AgentEnginePipeline` | Public facade (`start`) |
| `composeReadOnlyAgentEngine` | Wire real Intake/Understand/Decide/Prompt (+ optional State/Context/Tools) |
| `agentEngineStartInputSchema` / `AgentEngineStartInput` | Boundary input |
| `agentRunResultSchema` / `AgentRunResult` | Terminal result |
| `runEventSchema` / `RunEvent` | Safe event stream |
| `AgentRunHandle` | Opaque run handle |

```ts
const engine = composeReadOnlyAgentEngine({
  understandingLlm,
  runLlm,
  repositoryState,
  repositoryContext,
  tools,
});

const handle = engine.start({
  schemaVersion: 1,
  request: {
    sessionId: "s1",
    mode: "ask",
    userMessage: "What does src/auth.ts export?",
    workspace: { workspaceId: "ws" },
  },
  workspaceRoot: "/repo",
  repositoryState: {
    reference: { workspaceId: "ws", stateToken: "tok" },
    readiness: "ready",
  },
});

for await (const event of handle.events) {
  // reconstruct UI without secrets
}
const result = await handle.result;
```

## Flow (Phase 7)

```text
Intake → Understand → Decide → pin Repository State
  → retrieve Context → construct Prompt → invoke Model
  → execute authorized read-only Tools as needed
  → produce Result
```

Supported routes: `direct_answer`, `repository_answer`, `clarify`, `diagnose`.
`plan` / `execute` fail closed with `mutation_deferred` until Phase 8.

## Policy highlights

- Clarification is `status: "suspended"` (not failed).
- Active runs pin one repository `stateToken` and unpin on terminal paths.
- Model/tool loops honor budgets and abort signals deterministically.
- Tool calls use Decision Policy grants; model text cannot broaden authority.
- Completed tool `callId`s are idempotent within a run.
- Events never include secrets, full prompts, or raw sensitive payloads.

## Do not put here

- Intent classifiers / task analyzers (`request-understanding`)
- Route/grant authority (`decision-policy`)
- Retrieval/indexing (`repository-context` / `repository-state`)
- Prompt budgeting (`prompt-construction`)
- Tool schema enforcement (`tool-runtime`)
- Verification (`verification`)
- Mutation/approval/checkpoints (Phase 8)

## Tests

```bash
pnpm exec vitest run src/v8/modules/agent-engine
```

Includes contract/unit coverage and wired-facade e2e for direct answer,
repository answer, clarification, diagnose, cancellation, and budget exhaustion.
