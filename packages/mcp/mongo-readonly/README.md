# `@mitii/mcp-mongo-readonly`

First-party Mitii MCP **stdio** server for **read-only** MongoDB probes.

## Tools

| Tool | Purpose |
|------|---------|
| `list_collections` | Collection names |
| `describe_collection` | Infer fields from sampled docs |
| `query` | `find` with filter / projection / sort / limit |
| `aggregate` | Pipeline (rejects `$out` / `$merge` / `$function` / `$where` / `$accumulator`) |
| `count` | `countDocuments` |

## Env

| Variable | Required | Notes |
|----------|----------|-------|
| `MCP_MONGODB_URI` | yes* | `mongodb://` or `mongodb+srv://` (*or `MONGODB_URI`) |
| `MONGO_MAX_DOCS` | no | Cap rows (default 50, max 200) |

## Run

```bash
MCP_MONGODB_URI=mongodb://localhost:27017/mydb node bin/mitii-mcp-mongo-readonly.js
```

Catalog id: `mongo-readonly` → `npx -y @mitii/mcp-mongo-readonly`.

Inspired by [mcp-mongo-server](https://github.com/kiliczsh/mcp-mongo-server) read-only mode; Mitii ships its own AGPL server so Database mode does not depend on an external npx package.
