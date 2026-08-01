# `@mitii/cli`

Headless Mitii CLI over `@mitii/sdk` → `@mitii/v8` (with `@mitii/host` for indexing, checkpoints, memory, and skills).

## Install

```bash
npm install -g @mitii/cli
# or
npx @mitii/cli --help
```

Requires **Node.js 20+**. Native dependency: `better-sqlite3` (optional LanceDB for vectors). License: **AGPL-3.0-or-later**.

Published from this monorepo on `v*` release tags. For local development:

```bash
pnpm --filter @mitii/cli build
node apps/cli/bin/mitii.js --help
```

Legacy npm `@mitii/cli@2.7.x` is a different binary stack — prefer versions published from this tree.

## Quick start

```bash
mitii ask "What is recursion?" --echo
mitii index
mitii status --json
mitii session
mitii export-session "Summarize this repo" --out session.json --echo
```

## Commands

| Command | Behavior |
|---|---|
| `ask <prompt>` | SDK ask with streaming, cancel, clarify/approve |
| `session` | Interactive prompt loop |
| `index` | Full workspace index + publish repository state |
| `status` | Show latest persisted repository state |
| `export-session` | Run ask and write secret-free JSON export |
| `version` / `help` | Version and usage |

### Common options

| Option | Meaning |
|---|---|
| `--cwd <path>` | Workspace root (default: `process.cwd()`) |
| `--json` | Machine-readable JSON on stdout |
| `--echo` | Force `EchoLlmPort` even when API keys are set |
| `--clarify <text>` | Non-interactive clarification resume |
| `--approve` / `--deny` | Non-interactive approval resume |
| `--out <file>` | Session export path (`export-session`) |

`SIGINT` cancels the active run via `run.cancel()`.

## Config

No secrets in files:

- `.mitii/config.json` (cwd) or `~/.mitii/config.json`
- Fields: `provider`, `model`, `baseUrl`, `workspaceId`, `defaultMode`

API keys via environment only:

- `MITII_API_KEY` / `OPENAI_API_KEY`
- `MITII_BASE_URL`, `MITII_MODEL` (optional overrides)

Works with local OpenAI-compatible servers (Ollama, LM Studio) without a key when pointed at a local base URL.

## Out of scope

Daemon, board, channels, and cloud PR agents are not part of this CLI.

## Development (monorepo)

```bash
pnpm --filter @mitii/cli typecheck
pnpm --filter @mitii/cli test
pnpm --filter @mitii/cli build
node apps/cli/bin/mitii.js ask "ping" --echo --json
```

## Links

- Repo: [Mitii-dev/Mitii](https://github.com/Mitii-dev/Mitii)
- SDK: [`@mitii/sdk`](https://github.com/Mitii-dev/Mitii/tree/main/packages/sdk)
- Host kit: [`@mitii/host`](https://github.com/Mitii-dev/Mitii/tree/main/packages/host)
