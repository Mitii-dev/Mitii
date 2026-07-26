# @mitii/cli

Headless Mitii CLI. Runs go through `@mitii/sdk` → `@mitii/v8` only (no legacy kernel).

```bash
pnpm --filter @mitii/cli build
pnpm --filter @mitii/cli exec mitii --help
pnpm --filter @mitii/cli exec mitii ask "What is recursion?"
```

## Commands (Phase 13 smoke surface)

| Command | Behavior |
|---|---|
| `mitii --help` / `mitii help` | Print usage |
| `mitii ask <prompt>` | Non-mutating ask-mode run via SDK |
| `mitii version` | Print package version |

Deferred from legacy CLI (daemon, board, teams, jobs, channels): see `legacy/packages/` and Phase 15.

## Provider wiring

- Default smoke path uses `EchoLlmPort` (no network).
- Set `MITII_API_KEY` or `OPENAI_API_KEY` (and optional `MITII_BASE_URL` / `MITII_MODEL`) to use `OpenAiCompatibleLlmPort`.
