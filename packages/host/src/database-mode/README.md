# Database mode (`@mitii/host`)

Read-only **NL → schema discovery → SQL** overlay for Mitii hosts (Desktop, VS Code, CLI).

## Contracts

| Symbol | Role |
|--------|------|
| `DATABASE_MODE_SLUG` | Builtin profile slug: `database` |
| `NL_SQL_ANALYST_SKILL_ID` | Forced skill: `nl-sql-analyst` |
| `DatabaseModeConnectionStatus` | `disconnected` \| `connected` \| `mcp_disabled` |
| `resolveDatabaseModeStart` | Compiles start-input overlay (skills, MCP pins, projectRules) |
| `listInstalledDatabaseMcpServerIds` | Installed + enabled catalog/custom DB MCP ids |

**Never widens ToolGrant.** Ask-mode MCP visibility requires `requiredMcpServerIds` (see V8 `isMcpAllowedByGrant`). This module is the only place that pins DB servers when the UI mode is `database`.

## Folder layout

```text
database-mode/
  README.md                 ← this file
  ARCHITECTURE.md           ← flow + non-breakage
  constants.ts
  contracts.ts
  listInstalledDatabaseMcpServers.ts
  connectGuidance.ts
  resolveDatabaseModeStart.ts
  index.ts
  *.spec.ts
```

## Host integration

```ts
import {
  isDatabaseUiMode,
  resolveDatabaseModeStart,
} from '@mitii/host';

if (isDatabaseUiMode(uiMode)) {
  const overlay = resolveDatabaseModeStart({ workspaceRoot });
  // start({ mode: 'ask', ...overlay.startFields })
}
```

## Connection UX

- **No DB MCP:** `connectionStatus: 'disconnected'` + guidance projectRule / prompt prefix.
- **MCP on + DB server enabled:** pin ids → agent can discover schema then query (SQL or Mongo).
- **MCP master off:** `mcp_disabled` guidance.

## Safety

- Builtin profile: `agentMode: ask`, toolGroups `read` + `mcp` + `command` (no `edit`).
- Skill refuses DDL/DML and Mongo writes; first-party `@mitii/mcp-{sqlite,postgres,mongo}-readonly` packages are SELECT / read-only only.
