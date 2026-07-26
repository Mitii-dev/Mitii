export const CLI_HELP = `Mitii CLI (@mitii/cli) — headless agent over @mitii/sdk

Usage:
  mitii --help
  mitii help
  mitii version
  mitii ask <prompt> [options]
  mitii index [--cwd <path>] [--json]
  mitii status [--cwd <path>] [--json]
  mitii session [--cwd <path>] [--echo]
  mitii export-session <prompt> --out <file> [--echo]

Options:
  --cwd <path>       Workspace root (default: process.cwd())
  --json             Emit machine-readable JSON on stdout
  --echo             Force EchoLlmPort even when API keys are set
  --clarify <text>   Non-interactive clarification resume
  --approve / --deny Non-interactive approval resume
  --out <file>       Session export path (export-session)

Signals:
  SIGINT (Ctrl-C)    Cancel the active run via SDK run.cancel()

Config (no secrets):
  .mitii/config.json or ~/.mitii/config.json
  Fields: provider, model, baseUrl, workspaceId, defaultMode
  API keys: MITII_API_KEY / OPENAI_API_KEY only (never in config files)

Environment:
  MITII_API_KEY / OPENAI_API_KEY   Provider API key (optional)
  MITII_BASE_URL                   OpenAI-compatible base URL
  MITII_MODEL                      Model id (default: gpt-4o-mini)

Hosts stream events, cancel, clarify/approve, index/status,
usage/context inspection, and secret-free session export.
Daemon/board/channels are out of scope for this CLI.
`;
