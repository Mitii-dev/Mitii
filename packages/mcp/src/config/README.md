# Config

Owns MCP settings I/O and the opt-in builtin catalog:

| File | Role |
|---|---|
| `settings.ts` | Parse / read / write `.mitii/mcp.json` |
| `builtins.ts` | Store catalog (filesystem, memory, puppeteer, …) |

Hosts may wrap `settings` with VS Code `SecretStorage` or UI; this folder stays host-neutral.
