# `@mitii/v8`

`@mitii/v8` is the host-neutral Mitii agent runtime. It provides the pipelines, contracts, policy boundaries, model adapters, tool runtime, repository intelligence, memory, skills, planning, task-list, and verification modules needed to run an agent safely inside a host application.

The central design rule is simple: the model is not the authority boundary. The model can propose tool calls, but Decision Policy grants authority and Tool Runtime enforces that grant.

## What This Package Does

V8 turns a raw user request into a governed run:

```text
request intake
-> request understanding
-> decision policy
-> repository state/context
-> planning/task list/skills/memory
-> prompt construction
-> model gateway
-> tool runtime
-> verification
```

Hosts inject the environment-specific pieces through ports: filesystem, process execution, network, model providers, repository stores, vector stores, skills catalog, memory store, and verification command execution.

## Structure

```text
packages/v8/
  src/
    engine/
      agent-engine/        Full run orchestration and resume/checkpoint flow
      tool-runtime/        Granted tool execution and audit records
    modules/
      request-intake/      Raw request -> UserRequestEnvelope
      request-understanding/
                            Intent and task analysis
      decision-policy/     Route, grant, approval, verification authority
      repository-state/    Immutable workspace state publication
      repository-context/  Retrieval, selection, and assembly of context
      planning/            Structured PlanArtifact generation
      task-list/           Compact live checklist for a run
      prompt-construction/ ModelRequest assembly and budget management
      model-gateway/       Provider-neutral LLM contract and adapters
      skills/              Skill instruction selection
      memory/              Scoped memory retrieval and commit
      code-navigation/     Definition/reference/hover lookup
      change-impact/       Graph-based blast-radius analysis
      verification/        Post-change verification evidence
```

## Main Types And Contracts

| Area | Public type/schema | Meaning |
| --- | --- | --- |
| Request Intake | `CreateUserRequestInput`, `UserRequestEnvelope` | Raw host request and normalized request envelope |
| Understanding | `RequestUnderstandingResult`, `TaskAnalysis` | Intent, target, scope, risk, clarity, and recommendations |
| Decision Policy | `DecisionPolicyInput`, `ExecutionDecision`, `ToolGrant` | Route, grant, approval, mutation budget, and verification requirement |
| Repository State | `RepositoryStateReference`, `RepositoryStateDescriptor` | Stable pointer and immutable descriptor for indexed workspace state |
| Repository Context | `RepositoryContextPipelineInput`, `RepositoryContextPipelineResult` | Query plus pinned state -> retrieval/selection/assembly result |
| Planning | `PlanningInput`, `PlanningResult`, `PlanArtifact` | Structured plan output and status |
| Prompt Construction | `PromptConstructionInput`, `PromptConstructionResult`, `ModelRequest` | Model-ready request plus budget/provenance report |
| Model Gateway | `LlmPort`, `ModelCapabilities`, `ModelEvent` | Provider-neutral model interface |
| Tool Runtime | `ToolInvocationInput`, `ToolResult`, `ToolRuntimePorts` | Tool execution under an exact grant |
| Verification | `VerificationInput`, `VerificationResult` | Check evidence, diagnostics, and diff inspection |
| Agent Engine | `AgentEngineStartInput`, `AgentEngineResumeInput`, `AgentRunHandle`, `AgentRunResult` | Start/resume orchestration and final result |

All public contracts are backed by Zod schemas and exported from the package root where appropriate. Public callers should import from `@mitii/v8`; internal module paths are implementation details.

## Technical Details

- Runtime target: Node.js 20+.
- Schema versions are explicit. Breaking public contract changes require migration work.
- Repository states are immutable after publication and can be pinned for active runs.
- Tool authority is represented by `ToolGrant`, including allowed tools/effects, path scopes, command rules, network hosts, limits, approval mode, and optional mutation budget.
- Prompt Construction reserves output headroom before spending input context.
- Provider adapters normalize OpenAI-compatible, Anthropic, Gemini, and echo-model behavior into the same `ModelEvent` stream.
- Tool Runtime records bounded, redacted audit information for every tool call.
- Verification uses pinned repository-state project data and trusted manifest-derived checks.

## Install

```bash
npm install @mitii/v8
```

Most applications should use `@mitii/sdk` unless they need to wire V8 ports directly.

## Development

```bash
pnpm --filter @mitii/v8 typecheck
pnpm --filter @mitii/v8 test
pnpm --filter @mitii/v8 build
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for deeper boundary, storage, and security details.

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

AgentEngineStartInput -> AgentRunHandle -> AgentRunResult:

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

@mitii/v8 end-to-end runtime returns a result like this:

```json
{
  "schemaVersion": 1,
  "runId": "run-1",
  "requestId": "req-1",
  "status": "completed",
  "route": "execute",
  "planningDepth": "none",
  "answer": "Updated src/LoginForm.tsx so the Sign in button shows Signing in... and is disabled while submit is pending. Updated the existing LoginForm test to cover the pending state.",
  "pinnedState": { "workspaceId": "workspace-1", "stateToken": "state-abc" },
  "reasonCodes": ["completed"],
  "warnings": [],
  "usage": { "modelCalls": 2, "toolCalls": 5, "loopIterations": 2 },
  "durationMs": 8420
}
```
