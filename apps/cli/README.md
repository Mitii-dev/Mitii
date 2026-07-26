# @mitii/cli

Headless Mitii CLI. Runs go through `@mitii/sdk` → `@mitii/v8` only (no legacy kernel).

```bash
pnpm --filter @mitii/cli build
node apps/cli/bin/mitii.js --help
node apps/cli/bin/mitii.js ask "What is recursion?" --echo
node apps/cli/bin/mitii.js index --echo
node apps/cli/bin/mitii.js status --json
```

## Commands (Phase 15)

| Command | Behavior |
|---|---|
| `ask` | SDK ask with streaming, cancel, clarify/approve |
| `session` | Interactive prompt loop |
| `index` | Publish host workspace snapshot via Repository State |
| `status` | Show latest persisted repository state |
| `export-session` | Run ask and write secret-free JSON export |

Config: `.mitii/config.json` (no secrets). API keys via `MITII_API_KEY` / `OPENAI_API_KEY`.

Deferred: daemon/board/channels — `legacy/packages/`.
