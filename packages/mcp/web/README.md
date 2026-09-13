# `@mitii/mcp-web` — MCP server (search / fetch / optional memory)

Lives under **`packages/mcp/web`** (same MCP folder as the client).

Stdio **MCP server** over [`@mitii/search-kit`](../../search-kit).

| Package | Direction |
|---|---|
| `@mitii/mcp` (`packages/mcp`) | Mitii **calls** external MCP servers (client) |
| `@mitii/mcp-web` (`packages/mcp/web`) | Other agents **call** Mitii (server) |

## Tools

| Tool | Behavior |
|---|---|
| `web_search` | Brave / SearXNG / Tavily via env |
| `fetch_url` | Content resolvers with URL safety |
| `memory_search` | Opt-in read-only shareable facts — see [`src/memory/`](./src/memory/) |

## Layout

```text
packages/mcp/web/
|-- src/
|   |-- tools.ts
|   |-- memory/          # memory_search (MITII_MCP_WEB_MEMORY=1)
|   |-- server.ts
|   `-- index.ts
`-- bin/mitii-mcp-web.js
```

## Run

```bash
pnpm --filter @mitii/mcp-web build
node packages/mcp/web/bin/mitii-mcp-web.js
```

Depends on `@mitii/search-kit` only (not v8 / sdk / host).
See [ARCHITECTURE.md](./ARCHITECTURE.md) and [src/memory/README.md](./src/memory/README.md).
