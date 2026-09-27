# Database mode — architecture

## Request path (unchanged V8 spine)

```text
UI mode "database"
  → Host resolveDatabaseModeStart
  → SDK start({ mode: "ask", requiredMcpServerIds, requiredSkillIds, projectRules })
  → V8 Agent Engine (Intake → Decision Policy → Prompt → Model loop → Tool Runtime)
  → mcp__{db}__list_tables | describe_table | query
```

Debug / Code / Architect / Ask / Plan / Agent **without** UI mode `database` do not call this module → **no behavior change**.

## Why Ask + requiredMcpServerIds

V8 `filterToolDefinitions` / `isMcpAllowedByGrant`:

| Grant | MCP tools |
|-------|-----------|
| Agent write | Allowed |
| Ask/Plan read | Only when `requiredMcpServerIds` non-empty |

Database mode uses **Ask** (readonly Decision Policy) and pins DB MCP ids so tools appear without `@mcp:` for every message.

## Non-breakage

| Surface | Guarantee |
|---------|-----------|
| Default Ask | No auto pin |
| Debug | Separate skill `api-db-runtime-debug` |
| Mode profiles `.mitii/modes.json` | Builtin `database` available; `active` still opt-in |
| Mutations | Profile omits `edit` tool group |

## References

- MCP-Ref `sql-mcp-server` usage scenarios (list → describe → query)
- MCP-Ref `nlqueries` connect-then-ask product shape
- Mitii `@mitii/mcp-sqlite-readonly` + `@mitii/mcp-postgres-readonly` + `@mitii/mcp-mongo-readonly`
