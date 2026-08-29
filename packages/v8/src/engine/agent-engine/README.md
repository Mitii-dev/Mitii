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
  pipeline/                 Public facade plus cohesive run stages
    AgentEnginePipeline     start()/resume() orchestration
    runtime                 deps, events, window policy, run handle
    executeStart            intake → pin → understand → decide → prompt
    executeResume           clarification / plan / tool-approval continuation
    modelToolLoop           model turns, compaction, recovery
    executeTool             one authorized tool call + grant refresh
    pinAndDiscovery         repository pin, preflight snapshot, discovery pass
    verification            gate, repair queue, persist, user summary
  contracts/
    input/                  AgentEngineStartInput, AgentEngineResumeInput
    output/                 AgentRunHandle, AgentRunResult, RunEvent
    ports/                  AgentEngineDependencies
    errors/                 AgentEngineError
  actions/                  Mapping, prompt slices, output recovery, gates, evidence
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
  `grant_narrowed` is emitted only when the grant actually changed.
  After out-of-scope reads or compiler errors, Engine may `widen` the grant
  and record `grant_expanded`.
- `usage` reports `fileReadCalls` vs `uniqueFilePathsTouched`. Repeated
  re-reads of the same files emit `exploration_reread_heavy` mid-loop and
  after one nudge stop the spin with `exploration_stall_broken`. Stall
  detection uses paths read in the current loop (reset after a successful
  mutation) so verification repair can re-read known error files without
  aborting. Hosts may pass `loopPolicy.thresholds` (partial overrides of
  `AGENT_ENGINE_THRESHOLDS`) for lab tweaks; omit for shipped standards.
- Identical read-only tool+args reuse the prior result (`tool_result_deduped`).
  Mutations invalidate that content cache.
- Auto/hard compaction reinjects mid-run observations as well as pre-run
  memory. Observation count, observation size, reinjection size, dropped-turn
  summary size, compacted tool-result size, compacted tool-argument size, and
  live tool-result content size are all read from `WindowPolicy.compaction`.
  The model-loop prefix is preserved until the hard compaction ceiling so
  local KV caches and provider prompt caches can hit across turns.
- Tool-result history compaction preserves schema-shaped read/search arguments
  and replaces older tool results with path/range/finding stubs instead of
  slicing raw JSON or dropping tool rows from the summary.
- Empty memory retrieval is `memory_empty` (store wired, no facts). Missing
  memory port or workspace id remains `memory_skipped`.
- Task-list updates are validated through the Task List module. Successful
  mutations complete every matching change item (by path), not just the
  active row once per turn.
- Output truncation recovery can ask the model to continue safely within remaining budgets.
- When providers leak XML/tag-shaped tool requests into assistant text instead
  of structured tool deltas, the loop can recover a conservative subset of
  read/discovery tool calls from tag attributes and continue through normal
  Tool Runtime enforcement rather than immediately treating the turn as
  incomplete narration.
- Execute + write + mutation-intent turns that produce text and no `apply_patch` are **unfulfilled execute**. The loop nudges once (`unfulfilled_execute_recovered`, `maxUnfulfilledExecuteRecoveries: 1`) to call `apply_patch` in a bounded batch grouped by error class. A second text-only turn completes with `unfulfilled_execute_exhausted` instead of spinning.
- Rejected `apply_patch`/`delete_file`/`move_file` recoveries use a **separate** budget (`maxRejectedMutationRecoveries`, band-aware) so a stale-hunk → targeted read → retry cycle is not starved by the text-only unfulfilled-execute nudge.
- **Window bands** select shipped loop/stall standards from the effective context window (`compact` &lt; 50k, `standard` &lt; 100k, `wide` ≥ 100k). Edit permanent values in [`policy/loopPolicyBands.ts`](./policy/loopPolicyBands.ts). Merge order: `AGENT_ENGINE_THRESHOLDS` → band → optional host lab overrides (`loopPolicy.thresholds`). See [`policy/README.md`](./policy/README.md).
- `apply_patch` failures use distinct reason codes (`old_text_not_found`, `old_text_ambiguous`, `patch_target_missing`, `patch_hash_mismatch`, `identical_old_and_new`, `patch_syntax_invalid`). Retryable codes attach current file content so the model can copy exact `oldText` without a separate re-read. Targeted discovery after a rejected mutation follows those codes, not warning-string matching. `patch_conflict` remains as a legacy umbrella. Optional `replaceAll` replaces every exact occurrence; the default remains unique match.
- Compiler/tsc tool output is grouped by error code and asks for a class-wide batch, not one diagnostic at a time.
- `budget_exhausted` after mutations still captures `repo_build_state` phase `after` so remaining error counts are visible.
- Truncation on that same execute+write path recovers as a **tool-call** nudge, not essay continuation. Direct-answer truncation still continues the text.
- `context_ready` may include `retrievalSources` (`sourceId`, `status`, `candidateCount`) from hybrid retrieval reports.
- `model_turn` events include turn index, optional token counts, `finishReason`, and `truncated`.
- `composeReadOnlyAgentEngine` provides a useful read-only wiring helper.

### Start order

```text
intake
pin                          (whenever a workspace reference resolves — no longer waits on repositoryContextRequired)
Agent execute only: capture repoBuildStateBefore  (repair/mutation asks; synthesized read-only grant, no Decision Policy yet; never runs test/e2e scripts unless tests evidence is required)
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
model/tool loop               (per-turn max_tokens follows leftover context, capped by a real host override)
verification gate + repair queue (see below)
```

- Strategy is resolved by Engine, not Planning: `resolvePlanStrategyRules` (a pure function) runs before deciding whether to invoke discovery, then `applyPlanModeDiscoveryContract` upgrades cold Plan-mode asks (and shaped-discovery profile matches) to `discover_and_plan` unless exploration is `quick` or strategy is `follow_evidence`. Follow-up Plan asks that already resolved to `plan_from_ask` are left unchanged. Only `discover_and_plan` triggers Engine's bounded read-only discovery loop (max two model turns, file/search budget, no mutation tools) — it emits `discovery_started` / `discovery_progress` / `discovery_completed`, shows a temporary discovery task list, then calls Planning with `DiscoveryBrief` and `skipDiscover: true`. Discovery is seeded with preferred paths from explicit targets, retrieved context paths, and prior-turn path hints (deterministic pre-read before the model loop). Planning either runs its own one-shot Change+Verify draft call or falls back to the deterministic discovery skeleton. The discovery list is replaced by the plan-derived execution checklist. There is exactly one understanding LLM call and, for `discover_and_plan`, at most one additional plan-drafting call — never a second strategy classifier.
- **Plan discovery quality floor** (Plan mode, `explorationDepth !== "quick"`): discovery runs with `qualityFloor`. Shaped preflight may fall back to top-ranked glob hits when seed scoring filters everything; seed reads are not blocked by a spent search budget; the model loop nudges / forces tools until at least one file is read or the turn budget ends. Seed-read file bodies are injected as `<pre_read_evidence>` so the discovery model does not burn turns on `Already read` stubs; redundant re-reads of those paths return cached content and end the loop when no fresh tool ran. Evidence is sufficient only when the brief has ≥1 file read, ≥1 proposed change surface, and non-low confidence (`isPlanDiscoveryEvidenceSufficient`). Insufficient evidence emits `plan_mode_discovery_insufficient` / `discovery_failed` and replaces `strategyOverride` with `clarify` so Planning asks open questions instead of shipping a hollow Change plan. Thoroughness Low (`quick`) remains the escape hatch and does not apply the floor. Discovery `read_file` calls increment `usage.fileReadCalls` / unique paths.
- The resulting `planStrategy` is stored on the run result and plan-approval checkpoint. Hosts that carry an approved plan SHOULD also carry `approvedPlanStrategy`; otherwise the engine infers a conservative strategy from the artifact.

### Verification gate (repair while errors drop)

After a mutation, `finishAfterLoop` runs Verification, compares before/after when a snapshot exists, and **does not roll back**.

- **Passed**: commit mutations and complete as today.
- **Repairable failure** (`verification_failed`): persist the record, inject a compact remaining-error prompt (not the full dump), and run another model/tool loop. Window effort caps repairs (`run.maxVerificationRepairs`; medium is 8). The first mutate loop reserves that slice of `maxModelCalls` (`verification_repair_budget_reserved`) so a productive exploration pass cannot spend the whole ceiling before repairs start. Quick exploration stays at one repair. Stop after `maxStalledVerificationRepairs` non-improving verifies. Lint/format-only leftovers after typecheck and diagnostics are green complete as `implemented_unverified` instead of opening another repair loop. `verification_repair_attempted` / `verification_repair_succeeded` mark that path.
- **Still failing, or not repairable** (blocked / cancelled / infra-missing / stalled): keep the edits, write a short user summary, commit a memory pointer, and complete with `verification_incomplete` / `verification_kept_changes`.
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

Focused discovery / Plan-quality coverage:

```bash
pnpm exec vitest run \
  packages/v8/src/engine/agent-engine/tests/AgentEngineDiscovery.spec.ts \
  packages/v8/src/engine/agent-engine/actions/tests/planDiscoveryContract.spec.ts \
  packages/v8/src/engine/agent-engine/actions/tests/planDiscoveryQuality.spec.ts \
  packages/v8/src/engine/agent-engine/internal/tests/discoveryPassBudget.spec.ts
```

- `planDiscoveryContract` — cold Plan asks force `discover_and_plan`; `quick` / Agent mode do not.
- `planDiscoveryQuality` — quality-floor predicates and clarify fallback decision.
- `discoveryPassBudget` — shaped preflight must not starve seed reads / model turns.
- `AgentEngineDiscovery` — wired discovery loop; insufficient Plan evidence → `plan_mode_discovery_insufficient` + `clarify`.

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
  "usage": { "modelCalls": 2, "toolCalls": 5, "loopIterations": 2, "fileReadCalls": 3, "uniqueFilePathsTouched": 2 }
}
```
