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
|-- sqlite/                   # @mitii/mcp-sqlite — first-party DB server
|-- postgres/                 # @mitii/mcp-postgres — first-party DB server
|-- mongo/                    # @mitii/mcp-mongo — first-party DB server
|-- README.md                 # this file (umbrella)
`-- ARCHITECTURE.md
```

| Package | Path | Role |
|---|---|---|
| `@mitii/mcp` | `packages/mcp` (`src/`) | Client core: `.mitii/mcp.json`, transports, `mcp__*` registry |
| `@mitii/mcp-web` | `packages/mcp/web` | Server: `web_search`, `fetch_url`, optional `memory_search` |
| `@mitii/mcp-sqlite` | `packages/mcp/sqlite` | SQLite MCP (`MCP_DB_ACCESS=readonly\|readwrite`) |
| `@mitii/mcp-postgres` | `packages/mcp/postgres` | Postgres MCP (`MCP_DB_ACCESS`) |
| `@mitii/mcp-mongo` | `packages/mcp/mongo` | MongoDB MCP (`MCP_DB_ACCESS`) |

App hosts may keep **thin adapters** (e.g. `apps/vscode/src/mcp/`) that only wire VS Code UI → `@mitii/mcp`. Product logic stays under `packages/mcp`.

## Database catalog (Database mode)

Install from **Settings → Integrations → MCP** (category **Database**):

| Catalog id | Package | Env |
|---|---|---|
| `sqlite` | `@mitii/mcp-sqlite` | `SQLITE_PATH` + `MCP_DB_ACCESS` |
| `postgres` | `@mitii/mcp-postgres` | `DATABASE_URI` + `MCP_DB_ACCESS` |
| `mongo` | `@mitii/mcp-mongo` | `MCP_MONGODB_URI` + `MCP_DB_ACCESS` |

Access tier is controlled by `MCP_DB_ACCESS=readonly|readwrite` (Database mode UI) — not by separate catalog ids.

Legacy ids `sqlite-readonly` / `postgres-readonly` / `mongo-readonly` are migrated to the canonical ids on load.

## Per-turn MCP attach

Users can pin / `@mcp:excalidraw` like skills. Mentions are parsed in
**V8** (`packages/v8/src/modules/mcp-attach/`) and applied by
`filterToolDefinitions`. This client package still registers all enabled
servers; V8 scopes which `mcp__*` tools the model sees for that run.

## Scripts

```bash
pnpm --filter @mitii/mcp build
pnpm --filter @mitii/mcp-web build
pnpm --filter @mitii/mcp-sqlite build
pnpm --filter @mitii/mcp-postgres build
pnpm --filter @mitii/mcp-mongo build
pnpm --filter @mitii/mcp test
```

See [ARCHITECTURE.md](./ARCHITECTURE.md), [web/README.md](./web/README.md).
