export const CLI_HELP = `Mitii CLI (@mitii/cli) — headless agent over @mitii/sdk

Usage:
  mitii [--help | -h]
  mitii [--version | -v | version]
  mitii help
  mitii setup [--show] [--provider <id>] [--model <id>] [--test]
  mitii ask <prompt> [options]
  mitii ask --agent <id|path> [options]
  mitii ask --prompt-file <path|-> [options]
  mitii ask --recipe <id> [note] [options]
  mitii commit-message [note] [options]
  mitii pr-summary [note] [options]
  mitii changelog [note] [options]
  mitii run --auto "<task>" [options]
  mitii session [options]
  mitii index [--cwd <path>] [--json]
  mitii status [--cwd <path>] [--json]
  mitii export-session <prompt> --out <file> [--echo]
  mitii restore --list <runId> [--json]
  mitii restore <runId> <restorePointId> [--json]
  mitii recipe run <id|path> [--param key=value]... [--preview] [note]
  mitii memory pending|approve <id>|reject <id> [--json]
  mitii connect <channel> …

First run:
  1. mitii setup                 # pick provider + write .mitii/config.json
  2. export ANTHROPIC_API_KEY=…  # (or GEMINI_ / OPENAI_ / MITII_API_KEY)
  3. mitii session               # banner + interactive loop
  Or smoke without a key:  mitii ask "ping" --echo

Commands:
  setup            Interactive (or flag) model/provider setup
  ask <prompt>     One-shot agent run with streaming
  commit-message   Draft a commit message (auto-attaches git-commit-message)
  pr-summary       Draft a PR body (auto-attaches git-pr-summary)
  changelog        Draft Keep a Changelog entry (auto-attaches release-changelog)
  run --auto       Unattended CI run (agent + apply autonomy; no prompts)
  session          Interactive REPL (MITII banner + prompts)
  index            Full workspace index + publish repository state
  status           Show latest persisted repository state
  export-session   Run ask and write secret-free JSON export
  restore          Undo Agent file mutations to a RestorePoint (or --list)
  recipe           Run a parameterized RecipeSpec (prompt/mode/skills only)
  memory           List/approve/reject pending auto-mined memories
  connect          Chat bridges (telegram / discord / slack)
  version / help   Version and usage

Modes (--mode or config defaultMode):
  ask     Q&A / explain (default)
  plan    Read-only plan; no file edits
  agent   Edit + tools with approvals

Automation (Phase 0):
  --origin <o>       user | automation | api
                     automation/api suppress interactive clarify in policy
  --skill <id>       Force-attach a skill for this run (repeat up to 3 times)
  --recipe <id>      Writing recipe: commit-message | pr-summary | changelog
                     (gathers git context + force-attaches the matching skill)
  --autonomy <a>     readonly | propose | apply | apply_and_pr
                     fills mode + approval policy for unattended runs
  --auto             With "run": require unattended apply path (CI)
  --agent <id|path>  Load .mitii/agents/<id>.md (or a file path)
  --prompt-file <p>  Prompt from file, or - for stdin

Writing recipes (VS Code + CLI):
  commit-message  → skill git-commit-message
  pr-summary      → skill git-pr-summary
  changelog       → skill release-changelog
  Equivalent: mitii ask --recipe commit-message
  Chat: @skill:git-commit-message  (or /git-commit-message)

Parameterized recipes (Phase 2):
  mitii recipe run after-commit --param task="write tests"
  mitii recipe run commit-message --preview
  Specs live in .mitii/recipes/<id>.json (schemaVersion: 1).
  Compile fills prompt/mode/skills/autonomy only — never ToolGrant.

Exit codes:
  0   completed (or non-clarify suspend checkpoint in --json)
  1   failed / declined suspension
  2   usage / config error
  4   suspended needing clarification (policy / input gap)
  130 cancelled (SIGINT)

Options:
  -h, --help         Show this help
  -v, --version      Print package version
  --cwd <path>       Workspace root (default: process.cwd())
  --json             Emit machine-readable JSON on stdout
  --stream-json      NDJSON: one line per RunEvent, then a result line
  --echo             Force EchoLlmPort even when API keys are set
  --clarify <text>   Non-interactive clarification resume
  --approve / --deny Non-interactive approval: resume mutation/plan gates;
                     --approve also skips plan-gate on start (headless)
  --out <file>       Session export path (export-session)
  --mode <mode>      ask | plan | agent
  --origin <origin>  user | automation | api
  --autonomy <preset> readonly | propose | apply | apply_and_pr
  --skill <id>       Force-attach a skill for this run (repeat up to 3 times)
  --recipe <id>      commit-message | pr-summary | changelog
  --agent <id|path>  Agent markdown under .mitii/agents/ or a path
  --prompt-file <p>  Prompt file path, or - for stdin
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
  SIGINT / SIGTERM   Cancel the active run via SDK run.cancel()

Config (no secrets):
  .mitii/config.json or ~/.mitii/config.json
  Fields: provider, providerPreset, model, baseUrl, searxngBaseUrl, workspaceId,
          defaultMode, loopPolicy (optional lab: { enabled, thresholds })
  provider: echo | openai-compatible | anthropic | gemini
  API keys never go in config files — use env vars
  .mitii/safety.json   Optional tighten-only user rules (enabled:false by default)
  Permanent window bands live in @mitii/v8 policy/loopPolicyBands.ts
  loopPolicy lab overrides merge after the band (same as VS Code Developer)

Environment:
  MITII_PROVIDER                   echo | openai-compatible | anthropic | gemini
  MITII_MODEL / MITII_BASE_URL     Model id and API base URL
  MITII_API_KEY                    Generic key (any provider)
  SEARXNG_BASE_URL / MITII_SEARXNG_URL
                                   Free SearXNG for web_search (config searxngBaseUrl wins)
  BRAVE_API_KEY / MITII_SEARCH_API_KEY / TAVILY_API_KEY
                                   Optional paid search providers
  MITII_TASK_LIST_AUTO_ADVANCE     Product default on; set to 0 to disable
  MITII_SANDBOX=1                  Enable OS process sandbox (macOS/Linux; fail-closed)
  MITII_SANDBOX_NETWORK=allow|deny Network for sandboxed children (default deny)
  MITII_SANDBOX_IMAGE              Docker/Podman image (default alpine:3.20)
  ANTHROPIC_API_KEY                Claude / Anthropic
  GEMINI_API_KEY / GOOGLE_API_KEY  Gemini
  OPENAI_API_KEY                   OpenAI-compatible (OpenAI, DeepSeek, …)

CI example:
  mitii run --auto "run tests and fix failures" --echo
  # or with a real provider + MITII_SANDBOX=1 for OS confinement

Daemon/board UIs remain separate from interactive chat.
Phase 1 automation: mitii schedule | mitii serve | mitii-daemon
  (see docs/automation/README.md and packages/automation/ARCHITECTURE.md)
`;
