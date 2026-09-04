# `@mitii/cli`

Headless Mitii CLI over `@mitii/sdk` → `@mitii/v8` (with `@mitii/host` for indexing, checkpoints, memory, and skills).

## Install

```bash
npm install -g @mitii/cli
# or
npx @mitii/cli --help
```

Requires **Node.js 20+** (Discord/Slack bridges need **Node 22+** for built-in WebSocket). Native dependency: `better-sqlite3` (optional LanceDB for vectors). License: **AGPL-3.0-or-later**.

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
| `connect` | Bridge Mitii into Telegram, Discord, or Slack |
| `schedule` | CRUD / trigger / history for automation schedules |
| `serve` | Long-lived automation daemon (+ optional webhook ingress) |
| `events` | Ingest / list automation events (GitHub webhooks, etc.) |
| `version` / `help` | Version and usage (`-v` / `--version`, `-h` / `--help`) |

## Connect (channel bridges)

`mitii connect` runs a **long-lived bridge** from a chat channel into Mitii agent turns
(same SDK path as `mitii ask` / `mitii session`). The process stays in the foreground
until you stop it.

```bash
mitii connect                         # list installed adapters
mitii connect <channel> --help        # channel-specific options
mitii connect --stop                  # stop all running connectors for this cwd
mitii connect <channel> --stop        # stop one channel
```

### Do you need GitHub (`gh`)?

**No — not as a `connect` adapter.** Connectors are chat surfaces (Telegram, Discord, Slack).
GitHub is different:

| Need | Use |
|---|---|
| Chat with Mitii from phone / Discord / Slack | `mitii connect telegram\|discord\|slack` |
| PRs, issues, `gh` / `git` in a repo | Run Mitii **in the repo** (`--cwd`) with `--mode agent`; install [`gh`](https://cli.github.com/) on that machine if you want PR tooling |
| Bot that replies on PR / issue comments | Not a `connect` channel — use agent mode + `gh`, or a future issue-bot adapter |

### Available adapters

| Channel | Command | Transport |
|---|---|---|
| Telegram | `mitii connect telegram` | Bot API long-poll |
| Discord | `mitii connect discord` | Bot gateway (WebSocket) |
| Slack | `mitii connect slack` | Socket Mode (WebSocket) |

### Prerequisites (any channel)

1. Configure a real model (not echo), unless you are smoke-testing with `--echo`:

   ```bash
   mitii setup --provider anthropic --yes   # or ollama / gemini / …
   export ANTHROPIC_API_KEY=…               # matching provider key
   ```

2. Prefer indexing the workspace once (ask/connect will auto-index if needed):

   ```bash
   mitii index --cwd /path/to/repo
   ```

3. Run `connect` with that workspace as `--cwd` so tools and project rules apply to the right tree.

### Shared flags (all channels)

| Flag | Meaning |
|---|---|
| `--cwd <path>` | Workspace root (default: current directory) |
| `--mode ask\|plan\|agent` | Same modes as CLI (`ask` default — safest for chat) |
| `--echo` | Force Echo LLM (local smoke, no API key) |
| `--approve` | Auto-approve mutation/plan gates (**default** for connectors) |
| `--deny` | Do not auto-approve; suspended turns stop instead |
| `--allowed-user-id <id>` | Allowlist platform user id (repeatable). **Recommended** |
| `--stop` | Stop a running connector for this channel/cwd |
| `-h`, `--help` | Channel help |

### In-chat commands (all channels)

| Command | Effect |
|---|---|
| `/help` | Short connector help + mode/cwd |
| `/new` | Clear this thread’s Mitii conversation carry |
| `/whereami` | Print channel / user ids, cwd, mode |

Ordinary text becomes one Mitii turn; the reply is posted back to the same chat/thread.
History is kept **per thread** under `.mitii/connectors/<channel>/`.

---

### Telegram — step by step

#### 1. Create a bot

1. Open Telegram and chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, follow the prompts, copy the **bot token** (`123456:ABC…`).
3. Optional: `/setprivacy` → **Disable** if the bot should see all group messages (DMs work either way).

```bash
export TELEGRAM_BOT_TOKEN='123456:ABC…'
```

#### 2. Start the bridge

```bash
cd /path/to/repo
mitii connect telegram --token "$TELEGRAM_BOT_TOKEN"
# or omit --token when TELEGRAM_BOT_TOKEN is set

mitii connect telegram \
  --mode ask \
  --allowed-user-id 123456789
```

Telegram-only flags: `--token` / `-t`, `--bot-username` / `-u`.

#### 3. Allowlist your user id

1. Start once, send `/whereami` in chat, note `userId=…`.
2. Restart with `--allowed-user-id <that id>`.

#### 4. Stop

```bash
Ctrl-C
# or
mitii connect telegram --stop
```

---

### Discord — step by step

#### 1. Create a Discord application + bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Open **Bot** → **Add Bot** → **Reset Token** → copy the bot token.
3. Under **Privileged Gateway Intents**, enable **Message Content Intent** (required to read message text).
4. Open **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot permissions: at least **Send Messages**, **Read Message History**, **View Channels**
5. Open the generated URL, invite the bot to your server.

```bash
export DISCORD_BOT_TOKEN='your-bot-token'
```

#### 2. Start the bridge

```bash
cd /path/to/repo
mitii connect discord --token "$DISCORD_BOT_TOKEN"

mitii connect discord \
  --mode ask \
  --allowed-user-id 987654321012345678
```

Discord-only flags: `--token` / `-t` (or `DISCORD_BOT_TOKEN`).

Behavior:

- **DMs** — every message is handled (subject to allowlist).
- **Guild channels** — the bot only replies when **@mentioned**.

#### 3. Allowlist your Discord user id

1. Enable Discord Developer Mode (Settings → Advanced → Developer Mode).
2. Right-click your avatar → **Copy User ID**, or send `/whereami` to the bot.
3. Restart with `--allowed-user-id <id>`.

#### 4. Stop

```bash
Ctrl-C
# or
mitii connect discord --stop
```

---

### Slack — step by step

Slack uses **Socket Mode** (no public webhook URL).

#### 1. Create a Slack app

1. Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. **Socket Mode** → enable → create an **App-Level Token** with scope `connections:write` → copy `xapp-…`.
3. **OAuth & Permissions** → Bot Token Scopes, add at least:
   - `chat:write`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`
   - `app_mentions:read` (optional, useful in channels)
4. **Event Subscriptions** → enable → subscribe the bot to:
   - `message.im`
   - `message.channels` (and/or `message.groups` as needed)
5. **Install App** to your workspace → copy the **Bot User OAuth Token** `xoxb-…`.
6. Invite the bot to the channel: `/invite @YourBot`.

```bash
export SLACK_BOT_TOKEN='xoxb-…'
export SLACK_APP_TOKEN='xapp-…'
```

#### 2. Start the bridge

```bash
cd /path/to/repo
mitii connect slack \
  --bot-token "$SLACK_BOT_TOKEN" \
  --app-token "$SLACK_APP_TOKEN"

mitii connect slack \
  --mode ask \
  --allowed-user-id U012ABCDEF
```

Slack-only flags: `--bot-token`, `--app-token` (or the env vars above).

#### 3. Allowlist your Slack user id

1. Start once and send `/whereami` in a DM or channel with the bot.
2. Note `userId=U…` and restart with `--allowed-user-id U…`.

#### 4. Stop

```bash
Ctrl-C
# or
mitii connect slack --stop
```

---

### State on disk

Under the workspace:

```text
.mitii/connectors/telegram/<botUsername>.json
.mitii/connectors/telegram/<botUsername>.threads.json
.mitii/connectors/discord/default.json
.mitii/connectors/discord/default.threads.json
.mitii/connectors/slack/default.json
.mitii/connectors/slack/default.threads.json
```

Safe to delete `*.threads.json` to reset history. Tokens are **not** written to these files.

### How a turn works

1. The channel delivers an inbound message.
2. Allowlist / slash commands are handled locally.
3. Mitii runs `createCliClient` + `driveRun` (same engine as `mitii ask`).
4. `result.answer` is posted back (chunked if long).
5. Conversation carry is saved for the next message in that thread.

### Security checklist

- Prefer `--mode ask` unless you intentionally want edits.
- Always set `--allowed-user-id` for personal bots.
- Use `--cwd` pointing only at the repo you intend to expose.
- `--approve` is on by default for connectors (no TTY for y/n). Use `--deny` if you want suspensions to stop instead of mutating.
- Keep bot / app tokens in the environment — never commit them.

### Troubleshooting (connect)

| Symptom | What to try |
|---|---|
| Missing token errors | Set the channel env var or pass the matching `--token` / `--bot-token` / `--app-token` |
| `already running pid=…` | `mitii connect <channel> --stop` then start again |
| Echo / stub answers | Configure provider + API key; drop `--echo` |
| Unauthorized… | Your user id is not on `--allowed-user-id` |
| Telegram ignores group messages | BotFather → `/setprivacy` → Disable, or @mention the bot |
| Discord ignores guild messages | Enable **Message Content Intent**; @mention the bot |
| Slack not receiving events | Socket Mode on; app installed; bot invited; event subscriptions saved |
| `requires Node.js with global WebSocket` | Use Node **22+** (Discord/Slack bridges use the built-in WebSocket) |
| No repo context / weak tools | `mitii index --cwd …` then restart connect with that `--cwd` |

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
| `--origin <o>` | `user` \| `automation` \| `api` (unattended policy) |
| `--autonomy <a>` | `readonly` \| `propose` \| `apply` \| `apply_and_pr` |
| `--agent <id\|path>` | Load `.mitii/agents/<id>.md` or a markdown path |
| `--prompt-file <path>` | Prompt from file (`-` = stdin) |
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
| No repository state | `mitii index`, or let `ask` / `connect` auto-index |
| Wrong model | `mitii setup --show`, then `mitii setup` again |
| Connect / Telegram issues | See **Connect → Troubleshooting** above |

## Out of scope

Daemon and board UIs are not part of this CLI yet (Phase 1+). Channel bridges are
Telegram, Discord, and Slack via `mitii connect`. GitHub work uses the repo +
tools/`gh`, not a `connect` adapter (see **Connect** above).

**Phase 0 CI automation** works today: `--origin` / `--autonomy` / `--agent` /
`--prompt-file` plus the workflows under `.github/workflows/mitii-*.yml`. See
[docs/automation/README.md](../../docs/automation/README.md).

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
