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

## Connect an API

Keys go in the environment. Provider and model go in `.mitii/config.json` or `~/.mitii/config.json`.

```bash
# Anthropic (Claude)
export ANTHROPIC_API_KEY=sk-ant-...
mitii ask "What is recursion?"
```

```json
{ "provider": "anthropic", "model": "claude-sonnet-4-5" }
```

```bash
# Gemini
export GEMINI_API_KEY=...
# DeepSeek (OpenAI-compatible)
export MITII_API_KEY=...
# OpenAI
export OPENAI_API_KEY=sk-...
```

```json
{ "provider": "gemini", "model": "gemini-2.5-flash" }
```

```json
{
  "provider": "openai-compatible",
  "providerPreset": "deepseek",
  "model": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com/v1"
}
```

```json
{
  "provider": "openai-compatible",
  "baseUrl": "http://localhost:11434/v1",
  "model": "qwen3-coder:30b"
}
```

Overrides: `MITII_PROVIDER`, `MITII_MODEL`, `MITII_BASE_URL`, `MITII_API_KEY`.

Local Ollama / LM Studio do not need a key. Anthropic and Gemini do.

Cursor Cloud Agents are a separate agent API, not an LLM endpoint. Point `openai-compatible` at any `/v1/chat/completions` proxy if you need a custom gateway.

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
