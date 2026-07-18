# `src/core` map

Start here when changing agent behavior.

## Turn policy (edit first)

```text
pipeline/          ← classify → route → depth → skills → capabilities → loop helpers
  README.md        Stage order and editing checklist
```

## Mode UX (prepare a turn)

```text
modes/ask/         Ask mode prepare + prompts
modes/plan/        Plan mode prepare + prompts   (UX)
modes/agent/       Act/Agent prepare + prompts
```

## Plan engine (artifacts)

```text
plans/             Plan JSON, promptBuilder, PlanActEngine, planningDepth, persistence
runtime/PlanExecutor.ts
```

`modes/plan` decides *how Plan mode behaves*.  
`plans` owns *plan compilation / validation / execution*.

## Skills (playbooks)

```text
skills/bundled/<name>/
  SKILL.md
  scripts/         optional
  references/      optional
```

Examples: `log-audit/`, `documentation/`, `audit-cleanup/`.

## Everything else (infrastructure)

| Folder | Role |
|--------|------|
| `orchestration/` | ChatOrchestrator — wires pipeline into a turn |
| `runtime/` | AgentLoop, TaskAnalyzer, logAudit tools |
| `context/` | Retrieval + budgeting |
| `mcp/` | MCP server connect/register (not per-turn allowlists) |
| `tools/` | Builtin tool implementations |
| `safety/` | Approvals / ToolExecutor |
| `git/` | Git intent → risk → tools → skills (template for routing) |
| `llm/` `providers/` | Model clients |
| `config/` | Settings schema |
| `telemetry/` | Session logs |

## Rule of thumb

1. New **intent / audit type / docs type** → `pipeline/route/`
2. When to **plan** → `pipeline/depth/`
3. Which **playbook** → `pipeline/skills/` + `skills/bundled/`
4. Which **tools / MCP** → `pipeline/capabilities/`
5. Long procedures → **skill**, not hardcoded TS in `promptBuilder`
