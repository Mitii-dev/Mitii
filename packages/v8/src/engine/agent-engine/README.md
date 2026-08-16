# Agent Engine

Agent Engine is the full run orchestrator for V8. It owns the lifecycle of a request after the host decides to run V8 as an agent: start, event streaming, checkpointing, suspend/resume, model/tool loop coordination, task-list updates, and final result production.

It does not own the policy decision itself. Decision Policy decides the route and grant; Agent Engine applies that decision across the rest of the run.

## Responsibilities

- Validate `AgentEngineStartInput` and `AgentEngineResumeInput`.
- Create an `AgentRunHandle` with `runId`, `events`, `result`, and `cancel()`.
- Call intake, understanding, decision policy, repository context, planning, skills, memory, prompt construction, model gateway, tool runtime, task list, and verification.
- Persist checkpoints for resumable approval/clarification/plan gates.
- Avoid replaying completed tool calls after resume.
- Enforce model/tool loop budgets.
- Emit structured `RunEvent`s that hosts can render without exposing secrets.

## Structure

```text
agent-engine/
  pipeline/                 AgentEnginePipeline
  contracts/
    input/                  AgentEngineStartInput, AgentEngineResumeInput
    output/                 AgentRunHandle, AgentRunResult, RunEvent
    ports/                  AgentEngineDependencies
    errors/                 AgentEngineError
  actions/                  Mapping, prompt slices, output recovery, gates
  adapters/                 In-memory/file checkpoint stores, composition helpers
  internal/                 Checkpoints, event bus, budgets, task-list runtime
  tests/                    Unit and wired engine tests
```

## Main Types

- `AgentEngineStartInput`: raw request, optional workspace root, repository-state summary, projects, conversation, instructions, approved plan, optional approved plan strategy, task list, tool definitions, budget, model options, approval mode, dirty paths, and `explorationDepth` (`auto` | `quick` | `deep` — how hard to look before drafting a plan; orthogonal to Decision Policy's `planningDepth`, which is whether a visible plan exists at all).
- `AgentEngineResumeInput`: run id plus exactly one continuation: approval, clarification answer, or plan decision.
- `AgentRunHandle`: opaque active-run handle with events and final result.
- `AgentRunResult`: final status, route, planning depth, answer, optional plan, optional plan strategy, optional task list, optional suspension, pinned state, reason codes, warnings, usage, duration, and optional error.
- `AgentEngineDependencies`: injected ports/pipelines used by the orchestrator.
- `AgentRunCheckpoint`: persisted run state used by resume.

## Technical Details

- `start()` creates a new run and checkpoint.
- `resume()` continues from a persisted checkpoint and does not replay completed `callId`s.
- Runs can suspend for clarification, plan approval, or mutating tool approval.
- Tool calls are passed to Tool Runtime with the exact grant from Decision Policy.
- The engine may narrow authority after discovery but never expands the grant.
- Task-list updates are validated through the Task List module.
- Output truncation recovery can ask the model to continue safely within remaining budgets.
- `composeReadOnlyAgentEngine` provides a useful read-only wiring helper.

### Start order

```text
intake
pin                          (whenever a workspace reference resolves — no longer waits on repositoryContextRequired)
Agent execute only: capture repoBuildStateBefore  (unconditional; synthesized read-only grant, no Decision Policy yet)
understand                   (sees a capped preflight-diagnostic hint when errors exist — LLM classifier only, not the rule classifier)
decide
[clarification / unsupported-route short-circuits]
repository context           (if decision.repositoryContextRequired)
narrow
Plan mode only, repair-intent-gated: capture repoBuildStateBefore  (skipped if Agent mode already captured it)
skills / memory (optional)
planning:
  engine calls resolvePlanStrategyRules directly (no strategy LLM, no port method)
  discover_and_plan  -> bounded read-only discovery loop, then planning.plan({ discoveryBrief, strategyOverride })
  else               -> planning.plan({ strategyOverride }) immediately
prompt construction
model/tool loop
verification gate + repair queue (see below)
```

- Strategy is resolved by Engine, not Planning: `resolvePlanStrategyRules` (a pure function) runs before deciding whether to invoke discovery. Only `discover_and_plan` triggers Engine's bounded read-only discovery loop (max two model turns, file/search budget, no mutation tools) — it emits `discovery_started` / `discovery_progress` / `discovery_completed`, shows a temporary discovery task list, then calls Planning with `DiscoveryBrief` and `skipDiscover: true`. Planning either runs its own one-shot Change+Verify draft call or falls back to the deterministic discovery skeleton. The discovery list is replaced by the plan-derived execution checklist. There is exactly one understanding LLM call and, for `discover_and_plan`, at most one additional plan-drafting call — never a second strategy classifier.
- The resulting `planStrategy` is stored on the run result and plan-approval checkpoint. Hosts that carry an approved plan SHOULD also carry `approvedPlanStrategy`; otherwise the engine infers a conservative strategy from the artifact.

### Verification gate (no rollback)

After a mutation, `finishAfterLoop` runs Verification once, compares before/after when a snapshot exists, and **keeps the edits**.

- **Passed**: commit mutations and complete as today.
- **Did not pass**: do not roll back and do not inject diagnostics into the model loop. Persist a `VerificationRecord`, write a short user summary (deterministic counts, optional LLM narrative), commit a memory pointer, and complete with `verification_incomplete` / `verification_kept_changes`.
- **Cancel / interrupt**: persist whatever before/after snapshot exists so the next turn can reload it.
- **Retry**: a later user ask matching “fix the remaining verification errors” loads `loadLatest(workspaceId)` instead of scraping chat history.

Records live in `.mitii/verification/` (host store). They are not prompt-construction input.

## Ownership Boundaries

Owns run orchestration, events, checkpoint lifecycle, suspend/resume, loop control, and verification handoff.

Does not own intent classification, route authority, grant enforcement internals, provider-specific HTTP, repository indexing, filesystem semantics, or host UI.

## Tests

```bash
pnpm exec vitest run packages/v8/src/engine/agent-engine
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

AgentEngineStartInput -> events -> AgentRunResult:

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

Agent Engine run returns a result like this:

```json
{
  "status": "completed",
  "route": "execute",
  "answer": "Implemented the loading state and verified the LoginForm test.",
  "taskList": {
    "schemaVersion": 1,
    "source": "agent",
    "items": [
      { "id": "inspect-login", "title": "Inspect src/LoginForm.tsx", "status": "done" },
      { "id": "add-loading", "title": "Add pending button state", "status": "done" },
      { "id": "verify-login", "title": "Verify LoginForm behavior", "status": "done" }
    ]
  },
  "usage": { "modelCalls": 2, "toolCalls": 5, "loopIterations": 2 }
}
```
