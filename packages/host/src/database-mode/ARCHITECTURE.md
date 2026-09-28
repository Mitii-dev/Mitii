# Database mode — architecture

## Request path

```text
UI mode "database" + DB access (readonly | readwrite)
  → Host resolveDatabaseModeStart({ dbAccess })
  → SDK start({
       mode: readonly → ask | readwrite → agent,
       requiredMcpServerIds,
       requiredSkillIds: nl-sql-analyst,
       projectRules,
       approvalMode: never when readwrite (DB access is consent)
     })
  → V8 Agent Engine
  → mcp__{sqlite|postgres|mongo}__*
```

## DB access (not workspace approval)

| Tier | Agent mode | Approval | MCP tools |
|------|------------|----------|-----------|
| Read-only | Ask | (n/a) | Discovery + SELECT / find / aggregate / count |
| Read & write | Agent (no code-edit groups) | `never` — DB access is the consent | + execute_write / insert / update / delete / create_index |

UI hides the Approval dropdown in Database mode and shows DB access instead.
`MCP_DB_ACCESS` is stamped onto installed DB servers in `.mitii/mcp.json`.
Write tools are tagged `requiresWorkspaceWrite` per-tool.

## Packages

- `@mitii/mcp-sqlite` / `@mitii/mcp-postgres` / `@mitii/mcp-mongo`
- Legacy catalog ids `*-readonly` still work
