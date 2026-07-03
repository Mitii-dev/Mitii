# Mitii Benchmark And Eval

Private pnpm workspace package (`@mitii/benchmark`) for Mitii's enterprise benchmark, fixtures, and large-scale eval harness. It is excluded from the VSIX by `.vscodeignore`; the extension still ships from the repo root.

## Layout

```text
tools/benchmark/
  package.json
  run.mjs                     # Enterprise benchmark runner
  verify.mjs                  # Shared verification rules
  fixtures/                   # Pinned sample repos (optional node_modules per fixture)
  tasks/
    enterprise/               # Smoke, ask, plan, agent, regression tasks
    eval/
      generated/              # Standard/full eval shards (gitignored, generated locally)
      generated-smoke/        # CI smoke shards (gitignored)
  scripts/
    generate-tasks.mjs
    run-eval.mjs
    aggregate-results.mjs
    preflight.mjs
    ollama-matrix.sh
  results/                    # Aggregated eval reports (gitignored)
  inspect-ai/                 # Optional Python Inspect AI adapter
```

## Quick Start

From the **repo root** (`mitii-ai-agent/`):

```bash
pnpm install
pnpm run compile:cli
pnpm run benchmark:smoke    # 3 enterprise tasks, echo/stub
pnpm run eval:smoke         # 3 eval tasks, echo/stub (CI-safe)
```

Root scripts delegate to `@mitii/benchmark` via `pnpm --filter @mitii/benchmark`. You can also run commands from this directory:

```bash
cd tools/benchmark
pnpm run benchmark:smoke
pnpm run eval:smoke
```

Set `MITII_PACKAGE_ROOT` to the repo root if you invoke scripts from another cwd.

---

## Enterprise Benchmark

Runs the fixed ~26-task suite across Ask, Plan, and Agent modes on pinned fixtures.

```bash
# From repo root
pnpm run benchmark:smoke
pnpm run benchmark:all
pnpm run benchmark:integration

# Direct runner
node tools/benchmark/run.mjs --tier all --runtime real \
  --provider openai-compatible --model gpt-4o-mini
```

### Task tiers (`tasks/enterprise/`)

| Tier | File | Focus |
|------|------|-------|
| `smoke` | `smoke.json` | CLI wiring |
| `integration` | `integration.json` | Cross-mode integration |
| `ask` | `ask.json` | Retrieval and Q&A on fixtures |
| `plan` | `plan.json` | Structured planning |
| `agent` | `agent.json` | Tool loop and guidance |
| `regression` | `regression.json` | Fixed bugs from CHANGELOG |
| `all` | `index.json` | Everything |

Reports default to `.mitii/benchmark/report.json` and `.mitii/benchmark/report.md`.

---

## Large Eval (500–1000 tasks)

Measures agent potential at scale **outside VS Code**. Uses the same `verify.mjs` rules and `dist/cli.js` headless runner as the enterprise benchmark.

### 1. Preflight (required for real runtime)

Real eval uses **system Node**, not Electron. Rebuild `better-sqlite3` for Node before running:

```bash
pnpm run eval:preflight
# or manually:
pnpm run rebuild:node
pnpm run compile:cli
```

### 2. Generate tasks

```bash
pnpm run eval:generate          # standard profile → 500 tasks
pnpm run eval:generate:full     # full profile → 1000 tasks

# Custom count or output directory
node tools/benchmark/scripts/generate-tasks.mjs --count 750 \
  --output tools/benchmark/tasks/eval/generated
```

| Profile | Tasks | Use |
|---------|------:|-----|
| `smoke` | 3 | CI and wiring (`generated-smoke/`, does not overwrite `generated/`) |
| `standard` | 500 | Regular potential check |
| `full` | 1000 | Full assessment |
| `coding` | 300 | No fixtures |
| `fixtures` | 400 | Repo-heavy |

Generated shards: `tools/benchmark/tasks/eval/generated/`.

`eval:standard` auto-regenerates standard tasks if the index is missing or stale (&lt; 100 tasks).

### 3. Run eval

```bash
# Echo/stub (free, no model)
pnpm run eval:smoke

# Real model — Ollama example
pnpm run eval:standard -- \
  --provider openai-compatible \
  --base-url http://localhost:11434/v1 \
  --model qwen3-coder:30b \
  --limit 50

# Real model — OpenAI-compatible API
pnpm run eval:standard -- \
  --provider openai-compatible \
  --base-url https://api.openai.com/v1 \
  --model gpt-4o-mini \
  --limit 100

# Direct runner with all options
node tools/benchmark/scripts/run-eval.mjs \
  --tier eval \
  --runtime real \
  --provider openai-compatible \
  --base-url http://localhost:11434/v1 \
  --model qwen3-coder:30b \
  --concurrency 4 \
  --limit 50
```

### 4. Reports

| Output | Default path |
|--------|----------------|
| Single run JSON | `.mitii/eval/report.json` |
| Single run Markdown | `.mitii/eval/report.md` |
| Aggregated shards | `tools/benchmark/results/aggregated-report.json` |

```bash
pnpm run eval:aggregate -- --input tools/benchmark/results
```

### 5. Parallel sharded runs

```bash
mkdir -p tools/benchmark/results

for i in 1 2 3 4; do
  node tools/benchmark/scripts/run-eval.mjs \
    --shard $i/4 \
    --concurrency 4 \
    --runtime real \
    --provider openai-compatible \
    --base-url http://localhost:11434/v1 \
    --model qwen3-coder:30b \
    --output tools/benchmark/results/shard-$i.json &
done
wait

pnpm run eval:aggregate -- --input tools/benchmark/results
```

### 6. Ollama model matrix (free, local)

```bash
ollama serve   # terminal 1

pnpm run eval:matrix   # terminal 2 — runs multiple models × shards
```

Override with env vars: `PROFILE`, `SHARDS`, `CONCURRENCY`, `OLLAMA_BASE_URL`, `RESULTS_DIR`.

### Eval CLI flags

| Flag | Description |
|------|-------------|
| `--tasks <path>` | Task index JSON (default: `tasks/eval/generated/index.json`) |
| `--tier eval` | Filter tier (default: `eval`) |
| `--runtime real\|stub` | Full agent vs fast wiring |
| `--provider echo\|openai-compatible\|...` | LLM provider |
| `--model`, `--base-url` | Model endpoint |
| `--concurrency N` | Parallel workers (default: 4) |
| `--limit N` | Cap tasks (useful for dry runs) |
| `--shard i/N` | Run shard *i* of *N* |
| `--timeout-ms N` | Per-task timeout (default: 120000) |
| `--ensure-ready` | Auto-generate standard tasks if missing |
| `--no-ensure-ready` | Skip auto-generation |
| `--dry-run` | Print task count and exit |
| `--enable-puppeteer` | Enable Puppeteer MCP for browser tasks |

---

## Fixtures

| Fixture | Stack |
|---------|-------|
| `node-express` | Express API and routes |
| `react-vite` | React and TypeScript UI |
| `nest-api` | NestJS modules/controllers |
| `next-app` | Next.js App Router |

Browser / Puppeteer tasks:

```bash
mitii agent "Verify the home page title" \
  --runtime real \
  --enable-puppeteer \
  --approval auto \
  --cwd tools/benchmark/fixtures/react-vite
```

Fixture `node_modules` are gitignored. Install per fixture when running real browser or build tasks:

```bash
cd tools/benchmark/fixtures/react-vite && pnpm install
```

---

## Inspect AI (optional)

```bash
pip install -r tools/benchmark/inspect-ai/requirements.txt
export MITII_PACKAGE_ROOT=$(pwd)   # repo root
inspect eval tools/benchmark/inspect-ai/eval_tasks.py::mitii_eval_smoke
```

For production eval with a live model, use `mitii_eval_standard` and set provider env vars in the solver.

---

## Verification Rules

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

---

## What this measures

| Category | Tests Mitii's… |
|----------|----------------|
| `fixture-ask` | Code retrieval and Q&A on JS/TS stacks |
| `fixture-plan` | Structured planning on real repos |
| `fixture-agent` | Tool loop, skills, safe inspection |
| `coding-js` | Algorithm and JS knowledge |
| `reasoning` | Engineering judgment |
| `tool-calling` | Tool schema / MCP awareness |
| `gaia` | Multi-step and factual reasoning |
| `base-*` | Original enterprise benchmark tasks |
