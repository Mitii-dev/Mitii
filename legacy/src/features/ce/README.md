# CE Features

Community feature implementations. Each feature owns its tools, services, and context sources; commands/settings/skills/routes/prompt-fragment/UI-descriptor ownership per feature (rather than folder-wide) is still a follow-up, tracked in `docs/architecture/enterprise-migration-plan.md`.

Current feature folders: `apply`, `audit`, `context`, `git` (incl. `git/tools`), `github`, `indexing`, `mcp`, `memory`, `microtasks`, `modes/{ask,plan,agent}`, `orchestration` (`ChatOrchestrator`), `paths`, `pipeline`, `plans` (incl. `plans/tools`), `providers`, `release`, `rules`, `runtime`, `safety`, `scm`, `session`, `skills`, `subagents`, `task-board`, `tools` (`builtinTools.ts` — not yet split further per-feature).
