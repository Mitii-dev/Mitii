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
helpers/verify/       VerificationRequest/Outcome + baseline + budgets/wall + repair (S12)
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

P8 + S1–S3A + execution-seed/user-path-priority evacuate + soft loop-rails +
plan/shaped-discovery evacuate + §10.3 continue-reason trim + S10-EXT-AUTH +
S2-SCOPE + S1-MCP-RULES + S2C `answer` merge + S2-RU assess wrap + engine
assess flip + S13-ENGINE handoffs + S1 pre-decide materials + S11-MEM +
S3A-QUALITY + S1-GATE + S11-LOOP hub gates + ToolCallCache + S13 checkpoints +
host situation + enrich/briefcase-via-PC + S12-SELECT + S10 policy map live.
