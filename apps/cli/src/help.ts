export const CLI_HELP = `Mitii CLI (@mitii/cli) — headless agent over @mitii/sdk

Usage:
  mitii --help
  mitii help
  mitii version
  mitii ask <prompt> [options]
  mitii index [--cwd <path>] [--json]
  mitii status [--cwd <path>] [--json]
  mitii session [--cwd <path>] [--echo] [--mode <mode>]
  mitii export-session <prompt> --out <file> [--echo]

Options:
  --cwd <path>       Workspace root (default: process.cwd())
  --json             Emit machine-readable JSON on stdout
  --echo             Force EchoLlmPort even when API keys are set
  --clarify <text>   Non-interactive clarification resume
  --approve / --deny Non-interactive approval resume
  --out <file>       Session export path (export-session)
  --mode <mode>      ask | plan | agent (overrides config defaultMode)

Signals:
  SIGINT (Ctrl-C)    Cancel the active run via SDK run.cancel()

Config (no secrets):
  .mitii/config.json or ~/.mitii/config.json
  Fields: provider, providerPreset, model, baseUrl, workspaceId, defaultMode
  provider: echo | openai-compatible | anthropic | gemini
  API keys never go in config files

Environment:
  MITII_PROVIDER                   echo | openai-compatible | anthropic | gemini
  MITII_MODEL / MITII_BASE_URL     Model id and API base URL
  MITII_API_KEY                    Generic key (any provider)
  ANTHROPIC_API_KEY                Claude / Anthropic
  GEMINI_API_KEY / GOOGLE_API_KEY  Gemini
  OPENAI_API_KEY                   OpenAI-compatible (OpenAI, DeepSeek, …)

Hosts stream events, cancel, clarify/approve, index/status,
usage/context inspection, live task lists, and secret-free session export.
Daemon/board/channels are out of scope for this CLI.
`;
