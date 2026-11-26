# Mitii Runtime

Clubbed **v8-engine + tool-runtime** pump. Thin orchestration only — domain
logic stays in `modules/*`.

**Laws:** `ENGINE_REWRITE_PLAN.md` §0.1 / §0.2 / §17.

## Map

```text
flow/                 numbered pump (order.ts is the spine)
helpers/adapt/        host/SDK start → RuntimeStartInput
helpers/store/        Store + StoreManager (+ packTurn)
helpers/gates/        all suspend / complete
helpers/orient/       SituationPack builders (focus≠fence, cues)
helpers/grant/        scopesFromVerdict
helpers/plan/         when-to-run 3A + hollow reject + PlanningInput map
helpers/routes/       job-card bodies
helpers/rails/        soft nudges
helpers/tool-journal/ append / settle / idempotency
tools/                grant enforce + toModelToolSurface
adapters/             composeRuntime + shell wrap
```

## Host wiring (started)

`adaptHostStartToRuntime` maps AgentEngine/SDK start bags (dirtyPaths, cwd,
skills/MCP pins, conversation digest, git) into `RuntimeStartInput`.
`wrapEngineWithRuntimeShell` uses it so desktop/SDK starts feed Orient.

Still later: VS Code / desktop / CLI UI-specific gather (live catalog, LSP).

## Status

P8 + semantic S1–S3A closed. Host adapter + S2-READS peeks + decide verification live.
