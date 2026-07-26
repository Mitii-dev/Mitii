export const CLI_HELP = `Mitii CLI (@mitii/cli) — headless agent over @mitii/sdk

Usage:
  mitii --help
  mitii help
  mitii version
  mitii ask <prompt> [--cwd <path>] [--json]

Options:
  --cwd <path>   Workspace root (default: process.cwd())
  --json         Emit terminal result as JSON on stdout
  --echo         Force EchoLlmPort even when API keys are set

Environment:
  MITII_API_KEY / OPENAI_API_KEY   Provider API key (optional)
  MITII_BASE_URL                   OpenAI-compatible base URL
  MITII_MODEL                      Model id (default: gpt-4o-mini)

Phase 13 note: ask/plan/agent modes beyond ask, index, and deferred
daemon/board/team commands land in Phase 15 host UX — not here.
`;
