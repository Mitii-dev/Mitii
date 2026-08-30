export const CLI_HELP = `Mitii CLI (@mitii/cli) — headless agent over @mitii/sdk

Usage:
  mitii [--help | -h]
  mitii [--version | -v | version]
  mitii help
  mitii setup [--show] [--provider <id>] [--model <id>] [--test]
  mitii ask <prompt> [options]
  mitii session [options]
  mitii index [--cwd <path>] [--json]
  mitii status [--cwd <path>] [--json]
  mitii export-session <prompt> --out <file> [--echo]

First run:
  1. mitii setup                 # pick provider + write .mitii/config.json
  2. export ANTHROPIC_API_KEY=…  # (or GEMINI_ / OPENAI_ / MITII_API_KEY)
  3. mitii session               # banner + interactive loop
  Or smoke without a key:  mitii ask "ping" --echo

Commands:
  setup            Interactive (or flag) model/provider setup
  ask <prompt>     One-shot agent run with streaming
  session          Interactive REPL (MITII banner + prompts)
  index            Full workspace index + publish repository state
  status           Show latest persisted repository state
  export-session   Run ask and write secret-free JSON export
  version / help   Version and usage

Modes (--mode or config defaultMode):
  ask     Q&A / explain (default)
  plan    Read-only plan; no file edits
  agent   Edit + verify with approvals

Options:
  -h, --help         Show this help
  -v, --version      Print package version
  --cwd <path>       Workspace root (default: process.cwd())
  --json             Emit machine-readable JSON on stdout
  --echo             Force EchoLlmPort even when API keys are set
  --clarify <text>   Non-interactive clarification resume
  --approve / --deny Non-interactive approval: resume mutation/plan gates;
                     --approve also skips plan-gate on start (headless)
  --out <file>       Session export path (export-session)
  --mode <mode>      ask | plan | agent
  --loop-policy-json <json>
                     Lab: one-off threshold overrides for this run
                     (merged on the active window band; see README)
  --no-loop-policy   Ignore config loopPolicy for this run
  --provider <id>    setup: ollama | anthropic | gemini | openai | …
  --model <id>       setup: model id
  --base-url <url>   setup: OpenAI-compatible base URL
  --global           setup: write ~/.mitii/config.json
  --show             setup: print current config (no secrets)
  --test             setup: probe provider after writing
  --yes              setup: non-interactive (requires --provider)

Signals:
  SIGINT (Ctrl-C)    Cancel the active run via SDK run.cancel()

Config (no secrets):
  .mitii/config.json or ~/.mitii/config.json
  Fields: provider, providerPreset, model, baseUrl, workspaceId, defaultMode,
          loopPolicy (optional lab: { enabled, thresholds })
  provider: echo | openai-compatible | anthropic | gemini
  API keys never go in config files — use env vars
  Permanent window bands live in @mitii/v8 policy/loopPolicyBands.ts
  loopPolicy lab overrides merge after the band (same as VS Code Developer)

Environment:
  MITII_PROVIDER                   echo | openai-compatible | anthropic | gemini
  MITII_MODEL / MITII_BASE_URL     Model id and API base URL
  MITII_API_KEY                    Generic key (any provider)
  MITII_TASK_LIST_AUTO_ADVANCE     Product default on; set to 0 to disable
  ANTHROPIC_API_KEY                Claude / Anthropic
  GEMINI_API_KEY / GOOGLE_API_KEY  Gemini
  OPENAI_API_KEY                   OpenAI-compatible (OpenAI, DeepSeek, …)

Hosts stream events, cancel, clarify/approve, index/status,
usage/context inspection, live task lists, and secret-free session export.
Daemon/board/channels are out of scope for this CLI.
`;
