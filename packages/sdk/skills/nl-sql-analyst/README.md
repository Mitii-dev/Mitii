# nl-sql-analyst

Bundled skill for Mitii **Database** mode.

## Behavior

- Force-attached via `resolveDatabaseModeStart` → `requiredSkillIds: ['nl-sql-analyst']`
- Conflict group `database-analyst` (priority 200)
- Read-only: MCP SELECT probes only

## Override

```text
<workspace>/.mitii/skills/nl-sql-analyst/SKILL.md
```

## Related

- Host: `packages/host/src/database-mode/`
- MCP: `@mitii/mcp-sqlite`, `@mitii/mcp-postgres`, `@mitii/mcp-mongo`
- Debug (API empty data): `api-db-runtime-debug` (different skill)
