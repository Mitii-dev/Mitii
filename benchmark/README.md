# Mitii Enterprise Benchmark

Reproducible evaluation harness for **Ask**, **Plan**, and **Agent** modes across JavaScript/TypeScript stacks (Node, Express, React, NestJS, Next.js).

## Architecture

```text
benchmark/
  run-benchmark.mjs     # Orchestrator
  verify.mjs            # Verification rules
  tasks/                # Task definitions by mode + regression
  fixtures/             # Pinned sample repos
```

The CLI uses `HeadlessAgentHost`, which wires the **real** production agent pipeline (`ChatOrchestrator`, indexing, tools, skills, MCP) outside VS Code.

| Runtime | When | What runs |
|---------|------|-----------|
| `stub` | Smoke / echo | Fast wiring checks via `HeadlessAgentRunner` |
| `real` | Enterprise eval | Full agent: index, retrieval, tools, session logs |

## Quick start

```bash
cd mitii-ai-agent
npm run compile:cli
npm run benchmark:smoke          # CI-friendly (3 tasks, echo/stub)
npm run benchmark:all              # All tasks, real runtime
```

### Live model evaluation

```bash
export MITII_API_KEY=...
node benchmark/run-benchmark.mjs --tier all --runtime real --provider openai-compatible --model gpt-4o-mini
```

### Browser / Puppeteer lane

```bash
mitii agent "Verify the home page title" \
  --runtime real \
  --enable-puppeteer \
  --approval auto \
  --cwd benchmark/fixtures/react-vite
```

Built-in MCP: `@modelcontextprotocol/server-puppeteer` (toggle via `thunder.mcp.builtinServers.puppeteer` or `--enable-puppeteer`).

## Task tiers

| Tier | File | Focus |
|------|------|-------|
| `smoke` | `tasks/smoke.json` | CLI wiring |
| `ask` | `tasks/ask.json` | Retrieval & Q&A on fixtures |
| `plan` | `tasks/plan.json` | Structured planning |
| `agent` | `tasks/agent.json` | Tool loop & guidance |
| `regression` | `tasks/regression.json` | Fixed bugs from CHANGELOG |
| `all` | `tasks/index.json` | Everything |

## Fixture repos

| Fixture | Stack |
|---------|-------|
| `node-express` | Express API + routes |
| `react-vite` | React + TypeScript UI |
| `nest-api` | NestJS modules/controllers |
| `next-app` | Next.js App Router |

## Verification rules

| Rule | Meaning |
|------|---------|
| `exit_0` | CLI exit code 0 |
| `stdout_contains:<text>` | Output includes text |
| `stdout_not_empty` | Non-empty stdout |
| `json_path:<key>` | JSON stdout has key |
| `jsonl_event:<type>` | Agent stream event |
| `file_exists:<path>` | File in fixture |
| `file_contains:<path>:<needle>` | File content match |
| `skills_installed:<n>` | `.mitii/skills` count |
| `command_exit_0:<cmd>` | Shell command passes |
| `session_log_has:<event>` | JSONL session event |

## Reports

Written to `.mitii/benchmark/report.json` and `report.md`:

- Pass/fail per task
- Duration
- Verification breakdown
- Score percentage

## Skills in core

Bundled skills live at `src/core/skills/bundled/` (copied to `dist/core/skills/bundled` on compile). Workspace install uses `installBundledSkills()` on init.

## Tests

```bash
npm test -- test/benchmark
```

- `benchmark.harness.test.ts` — verify rules, fixtures, skills path
- `headless-agent-host.test.ts` — stub + real host initialization

## CI

Smoke benchmark runs in GitHub Actions after unit tests (`npm run benchmark:smoke`).

## Regression coverage map

| CHANGELOG area | Benchmark task |
|----------------|----------------|
| Verify command discovery | `regression-verify-command-discovery` |
| Skill-aware planning | `regression-skill-routing-plan` |
| Empty model response | `regression-empty-response-handling` |
| Phase-lock / agent loop | `regression-phase-lock-guidance` |
| Act MCP exclusions | `regression-act-mcp-exclusion-note` |
| Windows-safe paths | `regression-windows-path-safe` |
| Micro-task commit msg | `regression-microtask-commit-msg-hint` |
| Sequential-thinking cap | `regression-sequential-thinking-cap` |
