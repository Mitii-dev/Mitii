# `@mitii/mcp` family — all MCP code lives here

```text
packages/mcp/
|-- src/                      # @mitii/mcp — MCP **client** core (Mitii calls servers)
|   |-- contracts/
|   |-- config/               # settings + builtins catalog
|   |-- transports/
|   |-- manager/
|   `-- index.ts
|-- web/                      # @mitii/mcp-web — MCP **server** (others call Mitii)
|-- sqlite-readonly/          # @mitii/mcp-sqlite-readonly — first-party DB server
|-- postgres-readonly/        # @mitii/mcp-postgres-readonly — first-party DB server
|-- mongo-readonly/           # @mitii/mcp-mongo-readonly — first-party DB server
|-- README.md                 # this file (umbrella)
`-- ARCHITECTURE.md
```

| Package | Path | Role |
|---|---|---|
| `@mitii/mcp` | `packages/mcp` (`src/`) | Client core: `.mitii/mcp.json`, transports, `mcp__*` registry |
| `@mitii/mcp-web` | `packages/mcp/web` | Server: `web_search`, `fetch_url`, optional `memory_search` |
| `@mitii/mcp-sqlite-readonly` | `packages/mcp/sqlite-readonly` | Read-only SQLite MCP |
| `@mitii/mcp-postgres-readonly` | `packages/mcp/postgres-readonly` | Read-only Postgres MCP |
| `@mitii/mcp-mongo-readonly` | `packages/mcp/mongo-readonly` | Read-only MongoDB MCP |

App hosts may keep **thin adapters** (e.g. `apps/vscode/src/mcp/`) that only wire VS Code UI → `@mitii/mcp`. Product logic stays under `packages/mcp`.

## Database catalog (Database mode)

Install from **Settings → Integrations → MCP** (category **Database**):

| Catalog id | Package | Env |
|---|---|---|
| `sqlite-readonly` | `@mitii/mcp-sqlite-readonly` | `SQLITE_PATH` |
| `postgres-readonly` | `@mitii/mcp-postgres-readonly` | `DATABASE_URI` |
| `mongo-readonly` | `@mitii/mcp-mongo-readonly` | `MCP_MONGODB_URI` |

All three are **first-party**, disabled until installed, and read-only.

## Per-turn MCP attach

Users can pin / `@mcp:excalidraw` like skills. Mentions are parsed in
**V8** (`packages/v8/src/modules/mcp-attach/`) and applied by
`filterToolDefinitions`. This client package still registers all enabled
servers; V8 scopes which `mcp__*` tools the model sees for that run.

## Scripts

```bash
pnpm --filter @mitii/mcp build
pnpm --filter @mitii/mcp-web build
pnpm --filter @mitii/mcp-sqlite-readonly build
pnpm --filter @mitii/mcp-postgres-readonly build
pnpm --filter @mitii/mcp-mongo-readonly build
pnpm --filter @mitii/mcp test
```

See [ARCHITECTURE.md](./ARCHITECTURE.md), [web/README.md](./web/README.md).
