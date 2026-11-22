# Renderer API client

One module per feature (`chat`, `skills`, `mcp`, `recipes`, `provider`, `memory`, `checkpoints`, `profiles`, `history`, `indexStatus`, `evidence`, `workspace`, `git`). `http.ts` owns auth headers and NDJSON decoding (internal; only `streamNdjson` is re-exported). Import from `../api.js` (barrel).
