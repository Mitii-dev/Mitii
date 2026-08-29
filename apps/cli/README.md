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

## First run (new users)

```bash
mitii --help                 # or: mitii -h
mitii setup                  # pick provider + write .mitii/config.json
export ANTHROPIC_API_KEY=…   # or GEMINI_ / OPENAI_ / MITII_API_KEY
mitii session                # dotted MITII banner + interactive loop
```

Smoke without a live model:

```bash
mitii ask "What is recursion?" --echo
```

Check what is configured (never prints secrets):

```bash
mitii setup --show
mitii -v                     # or: mitii --version / mitii version
```

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
| `setup` | Interactive (or flag-driven) model/provider setup |
| `ask <prompt>` | SDK ask with streaming, cancel, clarify/approve |
| `session` | Interactive prompt loop with MITII banner |
| `index` | Full workspace index + publish repository state |
| `status` | Show latest persisted repository state |
| `export-session` | Run ask and write secret-free JSON export |
| `version` / `help` | Version and usage (`-v` / `--version`, `-h` / `--help`) |

### Modes

| Mode | Behavior |
|---|---|
| `ask` | Q&A / explain (default) |
| `plan` | Read-only plan; no file edits |
| `agent` | Edit + verify with approvals |

Set with `--mode <mode>` or `defaultMode` in config.

### Common options

| Option | Meaning |
|---|---|
| `-h`, `--help` | Show usage |
| `-v`, `--version` | Print package version |
| `--cwd <path>` | Workspace root (default: `process.cwd()`) |
| `--json` | Machine-readable JSON on stdout |
| `--echo` | Force `EchoLlmPort` even when API keys are set |
| `--clarify <text>` | Non-interactive clarification resume |
| `--approve` / `--deny` | Non-interactive approval resume |
| `--out <file>` | Session export path (`export-session`) |
| `--mode <mode>` | `ask` \| `plan` \| `agent` |
| `--loop-policy-json <json>` | Lab: one-off threshold overrides for this run |
| `--no-loop-policy` | Ignore config `loopPolicy` for this run |

Unknown options error out (they are not silently ignored).

`SIGINT` cancels the active run via `run.cancel()`.

### Loop / stall policy (lab)

By default the CLI uses **window-band standards** from the model context window
(`compact` &lt; 50k, `standard` &lt; 100k, `wide` ≥ 100k). Permanent ship values live in
`@mitii/v8` → `policy/loopPolicyBands.ts`.

Optional lab overrides (same merge as VS Code Developer → Custom loop policy):

```json
{
  "provider": "ollama",
  "model": "qwen3-coder:30b",
  "loopPolicy": {
    "enabled": true,
    "thresholds": {
      "maxReadOnlyToolTurnsBeforeMutationNudge": 14,
      "maxRejectedMutationRecoveries": 5
    }
  }
}
```

```bash
# One-off override (merged on top of config when enabled)
mitii ask "Fix types" --mode agent \
  --loop-policy-json '{"maxRejectedMutationRecoveries":5}'

# Force shipped bands only for this run
mitii ask "Fix types" --mode agent --no-loop-policy
```

Leave `loopPolicy` unset (or `"enabled": false`) for deploy / normal use.

### Setup options

| Option | Meaning |
|---|---|
| `--show` | Print current config (no secrets) |
| `--provider <id>` | `ollama`, `anthropic`, `gemini`, `openai`, `deepseek`, … |
| `--model <id>` | Model id |
| `--base-url <url>` | OpenAI-compatible base URL |
| `--global` | Write `~/.mitii/config.json` instead of project `.mitii/` |
| `--test` | Probe the provider after writing |
| `--yes` / `-y` | Non-interactive (requires `--provider`) |

```bash
# Local Ollama
mitii setup --provider ollama --yes

# Claude, then set the key in the shell
mitii setup --provider anthropic --model claude-sonnet-4-5 --yes
export ANTHROPIC_API_KEY=sk-ant-...

# Custom OpenAI-compatible gateway
mitii setup --provider openai-compatible --base-url http://localhost:1234/v1 --model local-model --yes --test
```

## Connect an API

Keys go in the environment. Provider and model go in `.mitii/config.json` or `~/.mitii/config.json` (prefer `mitii setup`).

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

## Session UI

`mitii session` prints a dotted **MITII** banner, then workspace / provider / mode, and the `mitii>` prompt. If you are still on the echo stub, it points you at `mitii setup`.

## Troubleshooting

| Symptom | What to try |
|---|---|
| Echo / stub answers only | `mitii setup`, then export the matching API key |
| `unknown option` | Typos fail loudly — run `mitii --help` |
| Index falls back to snapshot | Optional native deps / embeddings; ask still works with host snapshot |
| No repository state | `mitii index`, or let `ask` auto-index |
| Wrong model | `mitii setup --show`, then `mitii setup` again |

## Out of scope

Daemon, board, channels, and cloud PR agents are not part of this CLI.

## Development (monorepo)

```bash
pnpm --filter @mitii/cli typecheck
pnpm --filter @mitii/cli test
pnpm --filter @mitii/cli build
node apps/cli/bin/mitii.js ask "ping" --echo --json
node apps/cli/bin/mitii.js setup --show
```

## Links

- Repo: [Mitii-dev/Mitii](https://github.com/Mitii-dev/Mitii)
- SDK: [`@mitii/sdk`](https://github.com/Mitii-dev/Mitii/tree/main/packages/sdk)
- Host kit: [`@mitii/host`](https://github.com/Mitii-dev/Mitii/tree/main/packages/host)
