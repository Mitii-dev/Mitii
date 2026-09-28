# `@mitii/mcp-mongo`

First-party Mitii MCP **stdio** server for MongoDB (Database mode).

## Access mode

| `MCP_DB_ACCESS` | Tools |
|-----------------|-------|
| `readonly` (default) | `list_collections`, `describe_collection`, `query`, `aggregate`, `count`, `server_info` |
| `readwrite` | + `insert`, `update`, `delete`, `create_index` |

Aligned with MCP-Ref `mcp-mongo-server` (query/aggregate/count/insert/update/createIndex) plus Mitii discovery tools and a safe `delete`.

## Env

- `MCP_MONGODB_URI` or `MONGODB_URI` (required)
- `MCP_DB_ACCESS=readonly|readwrite`
- `MONGO_MAX_DOCS` (optional, default 50)

## Catalog

- Canonical id: `mongo`
- Legacy alias: `mongo-readonly` (same package; prefer setting `MCP_DB_ACCESS`)

```bash
MCP_MONGODB_URI=mongodb://localhost:27017/mydb MCP_DB_ACCESS=readonly \
  node bin/mitii-mcp-mongo.js
```
