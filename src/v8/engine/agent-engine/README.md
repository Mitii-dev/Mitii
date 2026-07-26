# Agent Engine

```text
Input:  AgentEngineStartInput { request, workspaceRoot?, dirtyPaths?, repositoryState?, budget? }
        AgentEngineResumeInput { runId, approval? | clarificationAnswer }
Output: AgentRunHandle { runId, events, result, cancel }
```

Coordinates public V8 facades through one cancellable run, including
mutation routes that suspend for approval and resume across process turns.
Does not implement intent classification, indexing, retrieval, prompting,
tool enforcement, or verification algorithms.

## Public API

| Export | Role |
|--------|------|
| `AgentEnginePipeline` | Public facade (`start`, `resume`) |
| `composeReadOnlyAgentEngine` | Wire real Intake/Understand/Decide/Prompt (+ optional State/Context/Tools/Verification/CheckpointStore/Skills/Memory) |
| `agentEngineStartInputSchema` / `AgentEngineStartInput` | Boundary input for `start` |
| `agentEngineResumeInputSchema` / `AgentEngineResumeInput` | Boundary input for `resume` |
| `agentRunResultSchema` / `AgentRunResult` | Terminal result |
| `runEventSchema` / `RunEvent` | Safe event stream |
| `AgentRunHandle` | Opaque run handle |
| `InMemoryRunCheckpointStore` | Test/single-process checkpoint store for suspend/resume |
| `PHASE8_SUPPORTED_ROUTES` / `DEFAULT_TOOL_DEFINITIONS` | Routing + default tool schemas (read-only + mutation) |

```ts
const engine = composeReadOnlyAgentEngine({
  understandingLlm,
  runLlm,
  repositoryState,
  repositoryContext,
  tools,
  verification,
  checkpointStore: new InMemoryRunCheckpointStore(),
  skillsCatalog: new InMemorySkillsCatalog([...]),
  memoryStore: new InMemoryMemoryStore([...]),
});

const handle = engine.start({
  schemaVersion: 1,
  request: {
    sessionId: "s1",
    mode: "agent",
    userMessage: "Fix the null check in src/parse.ts",
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

if (result.status === "suspended" && result.suspension?.kind === "approval_required") {
  const resumeHandle = engine.resume({
    schemaVersion: 1,
    runId: result.runId,
    approval: {
      approvalId: result.suspension.approval!.approvalId,
      decision: "approved", // or "denied"
    },
  });
  const resumed = await resumeHandle.result;
}
```

## Flow (Phase 8/9)

```text
Intake → Understand → Decide → pin Repository State
  → select Skills (optional) → retrieve Memory (optional)
  → retrieve Context → construct Prompt → invoke Model
  → execute authorized Tools (read-only or mutating) as needed
  → verify changes (when required) → produce Result
```

Supported routes: `direct_answer`, `repository_answer`, `clarify`, `diagnose`,
`plan`, `execute`.

Mutation tool calls (e.g. `apply_patch`) that require approval suspend the
run (`status: "suspended"`, `suspension.kind: "approval_required"`) with a
persisted `AgentRunCheckpoint`. `resume()` continues from that checkpoint
without replaying already-completed tool `callId`s:

- `approval.decision === "denied"` → terminal `status: "approval_denied"`,
  checkpoint deleted, nothing applied.
- `approval.decision === "approved"` → executes the pending tool once with
  the approval token, then continues the model/tool loop from the restored
  messages and budget.

After a successful mutation loop, when `decision.verification.required` and
files changed, the Engine gates completion on the `verification` port:
verified success commits the mutation transaction(s); failure rolls them
back via `tools.rollbackMutation` and the run finishes `failed`
(`verification_failed`, `mutation_rolled_back`).

## Policy highlights

- Clarification and approval suspensions are `status: "suspended"` (not failed).
- Active runs pin one repository `stateToken` for the whole suspend/resume
  lifecycle and unpin only on terminal paths.
- Model/tool loops honor budgets and abort signals deterministically;
  budget usage is restored from the checkpoint on resume.
- Tool calls use Decision Policy grants; model text cannot broaden authority.
- Completed tool `callId`s are idempotent within a run (and across resume);
  a call awaiting approval is deliberately left uncached so resume executes
  it exactly once.
- Events never include secrets, full prompts, or raw sensitive payloads.

## Do not put here

- Intent classifiers / task analyzers (`request-understanding`)
- Route/grant authority (`decision-policy`)
- Retrieval/indexing (`repository-context` / `repository-state`)
- Skill selection / conflict resolution (`skills`)
- Memory retrieval / retention (`memory`)
- Prompt budgeting (`prompt-construction`)
- Tool schema enforcement, mutation transactions, rollback (`tool-runtime`)
- Verification algorithms (`verification`)

## Tests

```bash
pnpm exec vitest run src/v8/engine/agent-engine
```

Includes contract/unit coverage, wired-facade e2e (direct answer, repository
answer, clarification, diagnose, cancellation, budget exhaustion), and
mutation approval coverage (deny, approve + resume without replay,
verification-triggered rollback) in `AgentEngineMutation.spec.ts`.
