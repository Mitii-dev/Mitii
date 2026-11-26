# Mitii Runtime

Clubbed **v8-engine + tool-runtime** pump. Thin orchestration only — domain
logic stays in `modules/*`.

**Laws:** `ENGINE_REWRITE_PLAN.md` §0.1 / §0.2 / §17.

## Map

```text
flow/                 numbered pump (order.ts is the spine)
helpers/adapt/        host/SDK start → RuntimeStartInput
helpers/store/        Store + StoreManager (+ packTurn / buildBriefcase)
helpers/task/         TaskList briefcase format + settle advance (S11-TASK)
helpers/gates/        all suspend / complete (evaluateGates → applyGate only)
helpers/orient/       SituationPack builders (focus≠fence, cues)
helpers/enrich/       ContextBundle + retrieval + omission budgets (S11)
helpers/verify/       VerificationRequest/Outcome + baseline + budgets/wall + repair/critique + decideVerificationGate (S12)
helpers/established-facts/ mid-run observation + compiler-queue facts (survive compaction)
helpers/run-evidence/ ledger + clamp for discovery/plan/tool/verify/stop evidence
helpers/tool-serialize/ model-facing tool result JSON + output budgets
helpers/loop-turn/      turn disposition + incomplete/unfulfilled recovery
helpers/clarification/ UI-safe ask clarification payload + resume amend
helpers/tool-recovery/ summarize/rejected recovery + leaked markup → tool calls
helpers/context-focus/ understanding focus + file relevance + candidate paths
helpers/preflight/     preflight grant/input/targets + unconditional capture gate
helpers/budgets/       clamp run budget + loop input tokens + wall-time/cache/turn clamp
helpers/thresholds/    agent + loop-policy thresholds + code-intel nudges
helpers/working-set/   recoverability block + mutation budget lines + sticky chars
helpers/skills/        preferred ids + skills_ready event + enrichment select (ports)
helpers/evidence-rail/ bind/recovery exhaustion terminals + sticky strip
helpers/mutation-cache/ post-mutation content/ledger/fact invalidation (ports)
helpers/handoff/      TaskHandoffNote + advance/skip/steer + Briefcase peaks (S13)
helpers/run-state/    RunState storeroom facade + checkpoint hydrate (S11-RS)
helpers/heartbeat/    Soft emit + durable heartbeat checkpoints (S11-HEART)
helpers/replate/      Approve-plan → new execute decision, scopes ⊆ plan (S10-REPLATE)
helpers/mcp/          attach/revoke mid-run (§16)
helpers/grant/        scopesFromVerdict
helpers/plan/         when-to-run 3A + hollow reject + PlanningInput map + telemetry
helpers/plan-discovery/ readonly discovery pump + quality floor (S3A-DISCOVER)
helpers/turn/         after_tool / on_budget hub + settle+ToolCallCache (S11-LOOP)
helpers/routes/       job-card bodies
helpers/rails/        soft nudges (never suspend)
helpers/tool-journal/ append / settle / idempotency
tools/                grant enforce + toModelToolSurface
adapters/             composeRuntime + PC/enrich ports + shell wrap
```

## Three layers (S10)

1. **Soft rails** (`helpers/rails`) — nudges only; never checkpoint.
2. **Gates** (`helpers/gates`) — `evaluateGates(phase)` → `applyGate` sole I/O.
3. **Resume** (`helpers/gates/resume`) — pure `ResumePlan`; flow executes.

## Enrich / Briefcase (S11)

`enrichContext` builds a typed `ContextBundle` (cacheClass per slice).
When `deps.enrich` ports are set, `enrichContextWithRetrieval` pulls skills /
memory / repo via module adapters (pump never reimplements retrieval).
`prioritizeOmissions` trims against `WindowPolicy` section shares (drop order
table-driven). `packTurn` layouts stable → semi → volatile and marks
capability-based cache breakpoints; tools ⊆ `toModelToolSurface(grant)`.
When `deps.promptConstruction` is set (default via `composeRuntime`), the turn
loop uses `buildBriefcaseViaPC` → PromptConstructionPipeline (still ⊆ grant).

Plan 3A discovery: `shouldRunDiscoveryPass` → temp TaskList →
`runDiscoveryPass` (readonly grant + optional tool peeks) →
`PlanningPipeline.compileDiscovery` → quality floor → plan draft →
`emitPlanPhaseTelemetry`.

## TaskList handoff (S13)

One active task. Completing/skipping writes a `TaskHandoffNote` into RunState.
Briefcase peaks = active task + previous handoff (truncated) + plan objective —
not the full handoff history.

## Storeroom (S11-RS)

`RunState` wraps `StoreManager` for the live visit inventory. Checkpoints embed
`storeSnapshot` via `buildCheckpointFromRunState`; resume uses
`hydrateRunStateFromCheckpoint`. See `helpers/run-state/README.md` for A–E
lost-context handling. Mid-run MCP: `applyMcpMidRun` / `applyMcpMidRunToRunState`.

## Host wiring

`prepareStartInput` gathers `runtimeSituation` for all hosts. Orient + Decide
consume it. Widen grants only via registered upgrade plates (`upgradePlateId`).

## Glossary (S3A)

| Term | Meaning |
|---|---|
| **mode** | Host interaction posture: `ask` / `plan` / `agent` |
| **route** | Job card from DecisionPolicy (`execute`, `plan`, `diagnose`, …) — not a nested engine |
| **planGate** | Whether execute must pause for plan approval (`none` \| `required_before_execute`) |
| **suspend** | Hub gate only — `evaluateGates` → `applyGate` (checkpoint). Soft rails never suspend |
| **steer** | Edit `PlanArtifact` without full rediscovery (`steerPlanArtifact`); rediscover only if targets invalidate |
| **replate** | On plan approve, mint a new execute decision with scopes ⊆ plan write targets |
| **windowBand** | `compact` / `standard` / `wide` from host `contextWindowTokens` (SSOT); plan vs execute budget split |

## Status

P8 + S1–S3A + pinDiscoveryPass thin + skills/evidence-rail/mutation-cache +
residual helpers pile + leaked-tool-markup recover + budgets/window-policy +
preflight + context-focus + tool-recovery + clarification + verify
repair/critique + output-truncation recovery + loop-turn + tool-serialize +
planningContext + run-evidence + established-facts + decideVerificationGate +
compaction ladder + session-control evacuate + residual engine evacuate closed +
execution-seed + soft loop-rails + plan/shaped-discovery + §10.3 +
S10/S11/S12/S13 + S2C/S2-RU live. Intentional engine-local:
applyPostPlanTaskListGate + refreshMemoryFactsForCompaction. Optional next: thin
remaining fat pipeline (`executeStart` / `executeToolFinish` / …).
