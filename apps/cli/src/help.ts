export const CLI_HELP = `Mitii CLI (@mitii/cli) — headless agent over @mitii/sdk

Usage:
  mitii [--help | -h]
  mitii [--version | -v | version]
  mitii help
  mitii setup [--show] [--provider <id>] [--model <id>] [--test]
  mitii doctor [--cwd <path>] [--json]
  mitii paths [--cwd <path>] [--json]
  mitii profile list|show|use <slug>|clear|init
  mitii mcp list|tools [serverId]|path [--json]
  mitii recipe list|show <id>|run <id> …
  mitii history list|show|usage|path [--json]
  mitii ask <prompt> [options]
  mitii ask --prompt "<text>" [options]
  mitii plan --prompt "<text>" [options]
  mitii agent --prompt "<text>" [options]
  mitii ask --agent <id|path> [options]
  mitii ask --prompt-file <path|-> [options]
  mitii ask --recipe <id> [note] [options]
  mitii commit-message [note] [options]
  mitii pr-summary [note] [options]
  mitii changelog [note] [options]
  mitii run --auto "<task>" [options]
  mitii session [options]
  mitii index [--cwd <path>] [--json]
  mitii index --status [--cwd <path>] [--json]
  mitii review [--preview] [--from <ref> --to <ref>] [--commit <hash>] [--format json|sarif] [--output <path>] [--effort low|medium|high]
  mitii status [--cwd <path>] [--json]
  mitii export-session <prompt> --out <file> [--echo]
  mitii restore --list <runId> [--json]
  mitii restore <runId> <restorePointId> [--json]
  mitii recipe run <id|path> [--param key=value]... [--preview] [note]
  mitii memory pending|approve <id>|reject <id> [--json]
  mitii connect <channel> …

First run:
  1. Copy .env.example → .env (or .mitii/.env) and fill keys
  2. mitii setup --provider anthropic --yes   # writes .mitii/config.json (no secrets)
  3. mitii doctor                             # verify config / keys / index paths
  4. mitii index && mitii session             # index workspace, then REPL
  Or smoke without a key:  mitii ask "ping" --echo

Commands:
  setup            Interactive (or flag) model/provider setup
  doctor           Check config, env keys, index, and log paths
  paths            Print where config / index / logs live
  profile          List / switch mode profiles (.mitii/modes.json)
  mcp              List MCP servers/tools from .mitii/mcp.json
  recipe           list|show|run parameterized RecipeSpec / writing recipes
  history          List/show CLI session logs + last-run token usage
  ask <prompt>     One-shot run (default mode: ask / config defaultMode)
  plan --prompt    One-shot plan mode (read-only; no file edits)
  agent --prompt   One-shot agent mode (edit + tools; use --autonomy apply for CI)
  commit-message   Draft a commit message (auto-attaches git-commit-message)
  pr-summary       Draft a PR body (auto-attaches git-pr-summary)
  changelog        Draft Keep a Changelog entry (auto-attaches release-changelog)
  run --auto       Unattended CI run (agent + apply autonomy; no prompts)
  session          Interactive REPL (MITII banner + prompts)
  index            Full workspace index + publish repository state
                   --status            Show Code/FTS/Embeddings pipeline health (no reindex)
  review           Deterministic review preview/prepare (+ SARIF); LLM findings via ask
                   --preview           Selection preview only (no prepare)
                   --from/--to <ref>   Diff range (required together unless --commit)
                   --commit <hash>     Single-commit review input
                   --format json|sarif Output shape (default json)
                   --output <path>     Write result to file
                   --effort low|medium|high  Prep effort band
                   Full LLM review: VS Code Review button (git changes), or:
                     mitii ask "review these changes" --mode ask --skill code-review-and-quality
  status           Show latest persisted repository state + index pipeline health
  export-session   Run ask and write secret-free JSON export
  restore          Undo Agent file mutations to a RestorePoint (or --list)
  memory           List/approve/reject pending auto-mined memories
  connect          Chat bridges (telegram / discord / slack)
  version / help   Version and usage

Modes (--mode, config defaultMode, or verb commands):
  ask     Q&A / explain (default) — also: mitii ask --prompt "…"
  plan    Read-only plan; no file edits — also: mitii plan --prompt "…"
  agent   Edit + tools with approvals — also: mitii agent --prompt "…"

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
  --prompt <text>    Prompt text (alternative to positional prompt)
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
  --approve / --deny Non-interactive approval: resume mutation/plan gates
                     and Continue stall walls; --approve also skips plan-gate on start (headless)
  --out <file>       Session export path (export-session)
  --mode <mode>      ask | plan | agent | database
  --origin <origin>  user | automation | api
  --autonomy <preset> readonly | propose | apply | apply_and_pr
  --skill <id>       Force-attach a skill for this run (repeat up to 3 times)
  --recipe <id>      commit-message | pr-summary | changelog
  --agent <id|path>  Agent markdown under .mitii/agents/ or a path
  --profile <slug>   One-off mode profile (architect|code|ask|debug|…)
  --prompt <text>    Prompt text (alternative to positional prompt)
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

Config (no secrets in git):
  .mitii/config.json or ~/.mitii/config.json
  Fields: provider, providerPreset, model, baseUrl, searxngBaseUrl, workspaceId,
          defaultMode, contextWindowTokens, embedding*, loopPolicy
  provider: echo | openai-compatible | anthropic | gemini
  API keys NEVER go in config.json — use env / .env files
  .env | .env.local | .mitii/.env | ~/.mitii/.env   (loaded automatically; shell wins)
  .mitii/modes.json    Mode profiles (mitii profile use <slug>)
  .mitii/agents/*.md   Named agents (--agent)
  .mitii/safety.json   Optional tighten-only user rules (enabled:false by default)
  .mitii/logs/         Full session JSONL (MM-DD-YYYY-HH-MM-thread_….jsonl)
                       Same shape as Desktop/VS Code (or MITII_LOGS_PATH)

Environment (common):
  MITII_PROVIDER / MITII_MODEL / MITII_BASE_URL / MITII_API_KEY
  MITII_CONTEXT_WINDOW             Explicit context window tokens
  MITII_LOGS_PATH                  Override log directory
  MITII_CLI_LOG=0                  Disable .mitii/logs session JSONL (on by default)
  ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
  SEARXNG_BASE_URL / MITII_SEARXNG_URL
  MITII_SANDBOX=1                  OS process sandbox (fail-closed)
  See docs: Environment variables + CI secrets

CI example:
  mitii run --auto "run tests and fix failures"
  # map secrets → env in GitHub Actions / Gitea (see docs)

Daemon/board UIs remain separate from interactive chat.
Phase 1 automation: mitii schedule | mitii serve | mitii-daemon
  (see docs/automation/README.md and packages/automation/ARCHITECTURE.md)
`;
