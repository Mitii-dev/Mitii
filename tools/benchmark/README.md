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
    manual/                   # Hand-written ask/plan/agent x easy/medium/hard suite (500 target)
    eval/
      generated/              # Standard/full eval shards (gitignored, generated locally)
      generated-smoke/        # CI smoke shards (gitignored)
  scripts/
    generate-tasks.mjs
    run-eval.mjs
    run-manual.mjs
    validate-manual-tasks.mjs
    aggregate-results.mjs
    preflight.mjs
    ollama-matrix.sh
  results/                    # Aggregated eval + manual-suite reports (gitignored)
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

Real eval uses **system Node**, not Electron. `better-sqlite3` must be rebuilt for Node (not VS Code's Electron):

```bash
pnpm run rebuild:node
pnpm run compile:cli
pnpm run eval:preflight
```

`eval:preflight` opens an in-memory SQLite database to verify the native module matches your Node ABI. If you recently ran `pnpm run rebuild:native` for F5 debugging, run `pnpm run rebuild:node` again before eval.

**Do not copy shell comments** from docs into your terminal. Run only the command itself:

```bash
pnpm run eval:preflight
```

not `pnpm run eval:preflight # rebuild better-sqlite3`.

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
| `saas-api` | Synthetic modular TypeScript API (~112 files, 17 modules) — see [Retrieval Eval](#retrieval-eval-recallndcg-baseline) |
| `monorepo` | pnpm workspace, 3 packages (`shared`/`api`/`web`) — cross-package refactor corner cases |
| `broken-repo` | Small Express API that's intentionally broken on disk (missing module + failing test) |
| `legacy-commonjs` | Old-style callback CommonJS, no TS, no test runner, no lint config |

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

### Keeping git clean after eval

Real eval runs **mutate fixture source files** (agents edit routes, components, READMEs, etc.). Session logs and build output are already gitignored. To restore the pinned fixture baseline after a run:

```bash
pnpm run eval:reset-fixtures
```

This reverts tracked changes under `tools/benchmark/fixtures/` and removes agent-created untracked files (e.g. `docs/`, scaffolded entry files). It also restores `generated-test` manifests if vitest touched them.

**Already gitignored** (safe to leave on disk): `.mitii/`, `node_modules/`, `dist/`, `.next/`, `tools/benchmark/tasks/eval/generated/`, `tools/benchmark/results/`.

---

## Retrieval Eval (Recall/nDCG baseline)

Measures `HybridRetriever` quality directly — no LLM involved — against a hand-labeled set of (query, expected files) pairs. This answers "does retrieval actually find the right files?" independently of how well the model uses whatever context it's given.

```bash
pnpm run rebuild:node   # once, if better-sqlite3 isn't built for system Node
pnpm run eval:retrieval
```

This runs `test/benchmark/retrieval-eval.test.ts`, which drives `HeadlessAgentHost` (the same production retriever wiring used by `ask`/`plan`/`agent`) against every fixture referenced in the dataset, calls the new `host.retrieveContext(query)` accessor to get raw `ContextItem[]` with no LLM call, and scores them against `expectedFiles`. It writes:

- `.mitii/benchmark/retrieval-report.json` — full per-query results plus per-fixture and overall Recall@5, Recall@10, nDCG@10, MRR
- `.mitii/benchmark/retrieval-report.md` — the same, as a table (also printed to stdout)

### Dataset

`tools/benchmark/datasets/retrieval-eval.json` — ~70 entries:

```json
{
  "id": "q-037",
  "fixture": "saas-api",
  "query": "Where is the logic that retries failed payments?",
  "expectedFiles": ["src/modules/payments/payments.service.ts"],
  "expectedSymbols": ["retryPayment"],
  "sourceType": "hand-labeled"
}
```

`sourceType` is one of `catalog` (derived from `fixture-catalog.json` entry files/symbols), `historical-plan` (adapted from real historical agent-run goals — mined once from local, gitignored `.mitii/tasks/*/plan.json` files and baked in as static entries), or `hand-labeled` (authored directly against `saas-api`). To add a query: pick a fixture, write a natural-language query, and list every `relPath` (relative to the fixture root) that should show up in the results. Re-run `pnpm run eval:retrieval` to see the effect.

### The `saas-api` fixture

`tools/benchmark/fixtures/saas-api/` is a synthetic, modular TypeScript API (~112 files, 17 domain modules — auth, orders, payments, webhooks, etc., each with controller/service/repository/DTOs) generated by `tools/benchmark/scripts/generate-large-fixture.mjs`. It exists because the other four fixtures are only 2-9 tracked files each — too small for keyword/file-name collisions to matter, so recall is nearly meaningless. Regenerate it (e.g. after editing the module list in the script) with:

```bash
node tools/benchmark/scripts/generate-large-fixture.mjs
```

### Debug logging

Set `MITII_DEBUG=1` to see granular per-source logs from the retrieval path (`HybridRetriever`, `ContextReranker`, `FtsContextSource`, `IndexedFileSearchContextSource`) — query text, per-source item counts and timings, dedup before/after counts, and rerank pool/result sizes. Silent by default; useful for diagnosing why a specific query under- or over-retrieves:

```bash
MITII_DEBUG=1 pnpm run eval:retrieval
```

### Reading the baseline

The first baseline run showed a counter-intuitive result: the large `saas-api` fixture scored *higher* (Recall@5 ≈ 0.85) than the small hand-built fixtures (nest-api ≈ 0.08, next-app ≈ 0.21). With `MITII_DEBUG=1` this traces back to the reranker: on small repos the pre-rerank candidate pool is already tiny (10-20 items), and `LexicalContextReranker` truncates to `rerankerConfig.topK` (8 by default) using a lexical-overlap-heavy blend — so a relevant file with a bare symbol match (e.g. "AppModule") can get crowded out by higher-lexical-overlap items like bundled rules or config files. That's a real signal for follow-up work on the reranker/topK tuning; this eval harness only measures and reports it.

## Manual Benchmark Suite (hand-written, 500 target)

Hand-authored (never generated) test cases covering Ask, Plan, and Agent modes, tagged by
difficulty, living under `tasks/manual/`:

```text
tools/benchmark/tasks/manual/
  ask/   {easy,medium,hard}/*.json
  plan/  {easy,medium,hard}/*.json
  agent/ {easy,medium,hard}/*.json
```

Each `*.json` is an array of task objects. There is no index to hand-maintain — every file
under `tasks/manual/**/*.json` is discovered automatically. **To add a new test case, drop a
JSON file (or append to an existing array) in the right `<mode>/<severity>/` folder.**

### Task schema

```json
{
  "id": "agent-hard-monorepo-cross-package-rename-001",
  "tier": "manual",
  "mode": "agent",
  "severity": "hard",
  "category": "refactor",
  "tags": ["monorepo", "cross-package", "corner-case"],
  "fixture": "monorepo",
  "prompt": "Rename validateEmail to isValidEmail in packages/shared and update every caller.",
  "rationale": "Cross-package rename requires finding every consumer across workspace boundaries.",
  "verify": ["exit_0", "jsonl_event:end", "file_not_contains:packages/shared/src/index.js:validateEmail"],
  "timeoutMs": 180000
}
```

- `mode` and `severity` must match the folder the file lives in (checked by the validator).
- `rationale` is a one-line note on why the case exists / what bug or edge it targets — not
  read by the runner, but keeps the suite auditable as it grows.
- `timeoutMs` is an optional per-task override (hard/nuke cases may need more than the 120s
  default).
- `verify` uses the same rule DSL as the rest of this package (see
  [Verification Rules](#verification-rules)), plus `stdout_not_contains:<text>`.

Difficulty rubric applied while authoring:

| Severity | Shape |
|---|---|
| `easy` | Single file, unambiguous goal, small fixture, few tool calls expected. |
| `medium` | Multi-file coordination, some inference required, `saas-api` or multi-module work. |
| `hard` | Monorepo cross-package work, broken-repo diagnosis, destructive/nuke prompts, prompt injection embedded in file content, malformed/contradictory instructions, saved-plan resume ambiguity, GitHub-issue/mdx-repair/audit-mode trigger phrasing. |

### Running

```bash
# Validate only (fast, no model calls)
pnpm run benchmark:manual:validate

# Run everything (validates first, then executes)
pnpm run benchmark:manual

# Filter by mode / severity / tag / fixture / id substring
node tools/benchmark/scripts/run-manual.mjs -- --mode agent --severity hard
node tools/benchmark/scripts/run-manual.mjs -- --tag corner-case
node tools/benchmark/scripts/run-manual.mjs -- --fixture broken-repo

# Real model, e.g. Ollama
node tools/benchmark/scripts/run-manual.mjs -- \
  --provider openai-compatible --base-url http://localhost:11434/v1 --model qwen3-coder:30b
```

Every task always runs with `--json` (even `ask`), so a `metrics` event
(`durationMs`, `toolCalls`, `sessionLogPath`) and the session log's `token_usage` events are
captured uniformly across all three modes — no separate instrumentation needed.

### Reports

| Output | Path |
|---|---|
| Dated run (JSON) | `results/manual/<YYYY-MM-DD>/report-<HHMMSS>.json` |
| Dated run (Markdown) | `results/manual/<YYYY-MM-DD>/report-<HHMMSS>.md` |
| Latest run | `results/manual/latest.{json,md}` |
| Trend history | `results/manual/history.md` (one row appended per run) |

Each report includes, per test case: pass/fail, duration, token usage (input/output/total,
summed per LLM turn), tool-call count, and a clickable relative link to that run's session log
file — plus a mode × severity matrix and a category breakdown. Token counts are Mitii's own
prompt-assembly/response-length *estimates* (`ChatOrchestrator`'s per-turn `token_usage` event),
not provider-billed usage — the headless CLI path doesn't wire up real per-call accounting
(that only exists on the VS Code extension's `ThunderController`). All of this reuses telemetry
(`SessionLogService`) already emitted by the CLI; nothing new was
instrumented.

### Extending the suite

New test cases just need a JSON file under the right `tasks/manual/<mode>/<severity>/`
folder. Run `pnpm run benchmark:manual:validate` before executing — it checks for duplicate
IDs, invalid `mode`/`severity` values, unknown `fixture` references, and unrecognized `verify`
rules, so a malformed new case fails fast instead of silently not running.

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
