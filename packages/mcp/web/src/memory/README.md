# Memory tools (optional)

Read-only **shareable** facts search over `<workspace>/.mitii/memory/facts.json`.

## Safety

| Rule | Behavior |
|---|---|
| Opt-in | Tools listed only when `MITII_MCP_WEB_MEMORY=1` |
| Workspace root | Requires `MITII_WORKSPACE_ROOT` |
| Path traversal | `realpath` must stay under workspace; only `facts.json` |
| Privacy | Soft-parse locally; **private** facts never returned |
| No V8 | Soft schema only — package must not import `@mitii/v8` |

## Env

```bash
MITII_MCP_WEB_MEMORY=1
MITII_WORKSPACE_ROOT=/path/to/repo
# optional override (still must resolve under workspace):
# MITII_MEMORY_FACTS_PATH=.mitii/memory/facts.json
```

## Files

- `softParseFacts.ts` — fail-closed envelope parse + ranking
- `pathSafety.ts` — root-bound path resolve
- `handleMemoryTool.ts` — `memory_search` handler
