# `@mitii/mcp` family — all MCP code lives here

```text
packages/mcp/
|-- src/                 # @mitii/mcp — MCP **client** (Mitii calls servers)
|-- web/                 # @mitii/mcp-web — MCP **server** (others call Mitii)
|   `-- src/memory/      # optional memory_search (shareable facts only)
|-- README.md            # this file (umbrella)
`-- ARCHITECTURE.md
```

| Package | Path | Role |
|---|---|---|
| `@mitii/mcp` | `packages/mcp` | Client: `.mitii/mcp.json`, transports, `mcp__*` registry |
| `@mitii/mcp-web` | `packages/mcp/web` | Server: `web_search`, `fetch_url`, optional `memory_search` |

App hosts may keep **thin adapters** (e.g. `apps/vscode/src/mcp/`) that only wire VS Code UI → `@mitii/mcp`. Product logic stays under `packages/mcp`.

## Per-turn MCP attach

Users can pin / `@mcp:excalidraw` like skills. Mentions are parsed in
**V8** (`packages/v8/src/modules/mcp-attach/`) and applied by
`filterToolDefinitions`. This client package still registers all enabled
servers; V8 scopes which `mcp__*` tools the model sees for that run.

## MCP memory (`memory_search`)

Lives at **`packages/mcp/web/src/memory/`** — not in the V8 memory module and not in the client.

| Env | Purpose |
|---|---|
| `MITII_MCP_WEB_MEMORY=1` | Opt-in: list + handle `memory_search` |
| `MITII_WORKSPACE_ROOT` | Workspace bound for `facts.json` |
| `MITII_MEMORY_FACTS_PATH` | Optional override (still must stay under workspace) |

Disabled by default. Soft-parses `.mitii/memory/facts.json`; **private** facts never returned. No `@mitii/v8` dependency.

```bash
pnpm --filter @mitii/mcp-web test
# or
cd packages/mcp/web && pnpm test
```

## Scripts

```bash
pnpm --filter @mitii/mcp build
pnpm --filter @mitii/mcp-web build
pnpm --filter @mitii/mcp test
pnpm --filter @mitii/mcp-web test
```

See [web/README.md](./web/README.md) and [web/src/memory/README.md](./web/src/memory/README.md).
