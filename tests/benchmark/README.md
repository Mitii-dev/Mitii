# Mitii Solid Benchmark

Fixed, deterministic coding-agent evaluation for Mitii.

Each case is:

```text
Prompt  →  Mitii (ask | plan | agent) on an isolated fixture copy  →  Checks
```

Checks are real repository evidence: `__bench__/grade.mjs`, files, `npm run build` / `test` / `typecheck`,
HTTP responses, workspace changed/unchanged. **No LLM grades another LLM.**

---

## Table of contents

1. [What you need](#1-what-you-need)
2. [Folder layout](#2-folder-layout)
3. [One-time setup](#3-one-time-setup)
4. [Install fixtures](#4-install-fixtures)
5. [Reset and clean up fixtures](#5-reset-and-clean-up-fixtures)
6. [Configure a model](#6-configure-a-model)
7. [Validate the suite](#7-validate-the-suite)
8. [Run the benchmark](#8-run-the-benchmark)
9. [Understanding reports](#9-understanding-reports)
10. [Filters and options](#10-filters-and-options)
11. [How a single case runs](#11-how-a-single-case-runs)
12. [Troubleshooting](#12-troubleshooting)
13. [Adding cases](#13-adding-cases)

---

## 1. What you need

| Requirement | Why |
|---|---|
| Node.js 20+ | Runner and fixtures |
| Monorepo deps (`pnpm install` at repo root) | CLI + packages Mitii uses |
| Fixture installs | Agent cases that run `npm test` / `build` need `node_modules` |
| A real model provider | Without setup you only get echo/stub answers (not a real score) |

Optional but useful:

- Extra disk for fixture `node_modules` and temp workspaces
- Higher agent timeout for slower local models

---

## 2. Folder layout

```text
tests/benchmark/
├── suites/
│   ├── frontend/cases/{feature,bugfix,docs,retrieval,testing}.jsonl
│   ├── backend/cases/{easy,medium,hard}.jsonl
│   ├── cicd/cases/{easy,medium,hard}.jsonl
│   └── testing/cases/{easy,medium,hard}.jsonl
├── fixtures/                 # pinned baseline repos (copied per case)
├── .workspaces/<runId>/      # live case copies (gitignored; deleted unless --keep-workspaces)
├── src/                      # runner, verifiers, reports, CLI
├── scripts/
│   ├── install-fixtures.mjs  # npm/pnpm install in every fixture
│   ├── reset-fixtures.mjs    # wipe installs + .workspaces, reinstall
│   ├── write-frontend-core.mjs  # regenerate frontend 70-case core
│   └── mitii-benchmark-agent.mjs
├── reports/runs/<runId>/     # live + final reports (gitignored)
├── benchmark.config.example.json
├── benchmark.config.json     # your local copy (gitignored)
└── docs/
    ├── ADDING_CASES.md
    ├── CHECK_REFERENCE.md
    └── FRONTEND_SUITE.md
```

### Domains

| Domain | Focus |
|---|---|
| `frontend` | Agent-only core: feature (20), bugfix (20), docs (10), retrieval (10), testing (10) |
| `backend` | APIs, services, bugfixes, retrieval, planning |
| `cicd` | Workflows, pipelines, deploy automation |
| `testing` | Unit/integration/e2e, coverage, regression |

Frontend uses **capability** JSONL files. Other domains still use difficulty files (`easy` / `medium` / `hard`).

---

## 3. One-time setup

All paths below are relative to the **Mitii repository root** unless you `cd`
into `tests/benchmark`.

### Step A — Install monorepo dependencies

```bash
pnpm install
```

What this does: installs Mitii packages (`@mitii/cli`, `@mitii/v8`, …) so the
benchmark agent adapter can call `apps/cli`.

### Step B — Create your benchmark config

```bash
cp tests/benchmark/benchmark.config.example.json \
   tests/benchmark/benchmark.config.json
```

What this does: tells the runner how to launch Mitii for each case
(command, args, timeout, concurrency). `benchmark.config.json` is gitignored so
local provider env and timeouts stay private.

You can edit timeouts later, for example:

```json
"timeoutMs": 600000
```

### Step C — Install fixtures (see next section)

### Step D — Configure a model (see [§6](#6-configure-a-model))

### Step E — Validate, then run a tiny smoke

```bash
pnpm benchmark:validate

pnpm --filter @mitii/solid-benchmark benchmark -- \
  --suite frontend \
  --limit 1 \
  --config tests/benchmark/benchmark.config.json
```

---

## 4. Install fixtures

Fixtures are small sample apps under `fixtures/`. Before each case, the runner
**copies** one fixture into a temp workspace and symlinks its `node_modules`.
Those dependencies must be installed once on the fixture itself.

### What install does

For every folder under `fixtures/` that has a `package.json`, the installer runs:

- `npm install --ignore-scripts`, or
- `pnpm install --frozen-lockfile` when `pnpm-lock.yaml` is present

Installed trees are **gitignored** (`node_modules`, lockfiles). You will not
commit them.

### Ways to install

**Way 1 — from repo root (recommended)**

```bash
pnpm benchmark:fixtures
```

**Way 2 — via the benchmark package**

```bash
pnpm --filter @mitii/solid-benchmark fixtures:install
```

**Way 3 — from inside the package**

```bash
cd tests/benchmark
npm run fixtures:install
```

**Way 4 — single fixture (manual)**

```bash
cd tests/benchmark/fixtures/frontend-app
npm install --ignore-scripts
```

Repeat for other fixtures as needed (`react-vite`, `next-app`, `node-express`, …).

### When to reinstall or reset

| Situation | Command |
|---|---|
| First setup / missing `node_modules` | `pnpm benchmark:fixtures` |
| Fixture `package.json` changed after a pull | `pnpm benchmark:reset` |
| Corrupt installs, stale locks, leftover `.next` / `dist` | `pnpm benchmark:reset` |
| Checks fail with “module not found” | `pnpm benchmark:reset` (or `pnpm benchmark:fixtures` if you only need install) |

---

## 5. Reset and clean up fixtures

Fixture installs and run artifacts can grow large. Prefer the reset script unless
you intentionally want a partial cleanup.

### Recommended — reset all fixtures

From the **repo root**:

```bash
pnpm benchmark:reset
```

Same action via the benchmark package:

```bash
pnpm --filter @mitii/solid-benchmark fixtures:reset

# or
cd tests/benchmark && npm run fixtures:reset
```

`fixtures:reset` walks every folder under `fixtures/` that has a `package.json`
and:

1. Deletes `node_modules`, `dist`, `.next`, `coverage`, and `.mitii`
2. Deletes generated lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`)
3. Deletes leftover **case workspaces** under `tests/benchmark/.workspaces/`  
   (and any legacy `${TMPDIR}/mitii-solid-benchmark/` from older runs).  
   This is where agent file edits live; each case copies a fixture there — it
   does not mutate `fixtures/` source
4. Reinstalls deps (`npm install --ignore-scripts`, or `pnpm install` for the
   `pnpm-workspace.yaml` monorepo fixture)

Fixture **source** files under `fixtures/` are left as-is (committed baseline +
any local edits you made). To also delete written run reports:

```bash
pnpm --filter @mitii/solid-benchmark fixtures:reset -- --reports
# or: cd tests/benchmark && npm run fixtures:reset -- --reports
```

### Manual cleanup (optional)

Use these only when you need a single step. Otherwise run `pnpm benchmark:reset`.

**A. Remove fixture `node_modules` (keep source)**

```bash
find tests/benchmark/fixtures -type d -name node_modules -prune -exec rm -rf {} +
```

Then reinstall: `pnpm benchmark:fixtures`.

**B. Remove generated lockfiles**

```bash
find tests/benchmark/fixtures \
  \( -name package-lock.json -o -name pnpm-lock.yaml -o -name yarn.lock \) \
  -delete
```

**C. Remove build outputs inside fixtures**

```bash
find tests/benchmark/fixtures \
  \( -type d \( -name dist -o -name .next -o -name coverage \) \) -prune \
  -exec rm -rf {} +
```

**D. Remove benchmark reports**

```bash
rm -rf tests/benchmark/reports
# or include in reset: npm run fixtures:reset -- --reports
```

Reports are regenerated on the next run.

**E. Case workspaces**

Also cleared by `pnpm benchmark:reset`. Manual equivalent:

```bash
rm -rf tests/benchmark/.workspaces
# legacy OS temp (older runs only)
rm -rf "${TMPDIR:-/tmp}/mitii-solid-benchmark"
```

---

## 6. Configure a model

The benchmark agent calls Mitii CLI (`ask` / index). Mitii must talk to a real
model. Pick **one** of the approaches below.

> Do **not** use `--echo` for scoring. Echo only checks wiring; agent cases that
> create files will fail.

### Way A — Interactive / flag setup (writes config)

```bash
# See current config (never prints secrets)
node apps/cli/bin/mitii.js setup --show

# Local Ollama (default local daemon)
node apps/cli/bin/mitii.js setup --provider ollama --yes --test

# Ollama or any OpenAI-compatible server at a custom URL
node apps/cli/bin/mitii.js setup \
  --provider openai-compatible \
  --base-url http://127.0.0.1:11434/v1 \
  --model your-model-name \
  --global \
  --yes \
  --test

# Cloud Anthropic example
node apps/cli/bin/mitii.js setup --provider anthropic --model claude-sonnet-4-5 --yes
export ANTHROPIC_API_KEY=sk-ant-...
```

- `--global` writes `~/.mitii/config.json` (useful so isolated fixture workspaces
  still resolve the same provider).
- Without `--global`, config is written under the project `.mitii/`.
- `--test` probes the provider after writing.
- Local Ollama / many open gateways need **no API key**. Cloud providers do.

### Way B — Environment overrides (no file edit)

These override file config for the current shell (and for the benchmark if you
export them before `pnpm benchmark…`):

```bash
export MITII_PROVIDER=openai-compatible
export MITII_BASE_URL=http://127.0.0.1:11434/v1
export MITII_MODEL=your-model-name
# Optional if the gateway requires any token:
# export MITII_API_KEY=...
```

Other common keys:

| Env | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic |
| `GEMINI_API_KEY` | Gemini |
| `OPENAI_API_KEY` | OpenAI |
| `MITII_API_KEY` | Generic OpenAI-compatible gateways |

### Way C — Bake env into `benchmark.config.json`

Useful when you want the run self-contained:

```json
{
  "agent": {
    "timeoutMs": 600000,
    "env": {
      "MITII_PROVIDER": "openai-compatible",
      "MITII_BASE_URL": "http://127.0.0.1:11434/v1",
      "MITII_MODEL": "your-model-name"
    }
  }
}
```

(Keep the existing `command` / `args` / `cwd` from the example file.)

### Smoke-test Mitii before the suite

```bash
node apps/cli/bin/mitii.js ask "Reply with the single word: pong" --mode ask --json
```

You should see a real model answer, not an echo stub.

---

## 7. Validate the suite

Validation checks IDs, fixtures, required check types, and per-domain counts
from each `suite.json`. It does **not** call the model.

**Way 1 — all domains**

```bash
pnpm benchmark:validate
```

**Way 2 — one domain**

```bash
pnpm --filter @mitii/solid-benchmark validate -- --suite frontend
```

**Way 3 — from package dir**

```bash
cd tests/benchmark
npm run validate
npm run validate -- --suite backend
npm run suites    # print domain names + easy/medium/hard counts
```

**Way 4 — harness unit tests (runner/verifiers, no LLM)**

```bash
cd tests/benchmark
npm test
```

---

## 8. Run the benchmark

### Recommended first runs

Start small so you can confirm model + fixtures + reporting:

```bash
# Dry run: list what would execute (no agent)
pnpm --filter @mitii/solid-benchmark benchmark -- \
  --suite frontend \
  --limit 5 \
  --dry-run \
  --config tests/benchmark/benchmark.config.json

# One case by id substring
pnpm --filter @mitii/solid-benchmark benchmark -- \
  --suite frontend \
  --id fe-feature-001 \
  --config tests/benchmark/benchmark.config.json

# Five easy frontend cases (docs + retrieval)
pnpm --filter @mitii/solid-benchmark benchmark -- \
  --suite frontend \
  --difficulty easy \
  --limit 5 \
  --config tests/benchmark/benchmark.config.json
```

### Full domain runs

```bash
pnpm benchmark:frontend
pnpm benchmark:backend
pnpm benchmark:cicd
pnpm benchmark:testing
```

Or:

```bash
pnpm --filter @mitii/solid-benchmark benchmark -- \
  --suite frontend \
  --config tests/benchmark/benchmark.config.json
```

### From `tests/benchmark`

```bash
cd tests/benchmark
npm run benchmark -- --suite frontend --limit 3 --config benchmark.config.json
npm run benchmark:backend -- --difficulty easy --limit 10
```

### Keep workspaces for debugging

```bash
pnpm --filter @mitii/solid-benchmark benchmark -- \
  --suite frontend \
  --id fe-003 \
  --keep-workspaces \
  --config tests/benchmark/benchmark.config.json
```

Temp dirs are kept under `tests/benchmark/.workspaces/<runId>/` (gitignored).

### Concurrency

Default is `1` (safest for local models). To parallelize (more CPU/RAM/API load):

```bash
pnpm --filter @mitii/solid-benchmark benchmark -- \
  --suite backend \
  --concurrency 2 \
  --config tests/benchmark/benchmark.config.json
```

---

## 9. Understanding reports

Reports are written **after every case**, then refreshed at the end.

```text
tests/benchmark/reports/runs/<runId>/
├── summary.json          # live + final aggregate (includes usageTotals)
├── summary.md
└── cases/
    ├── <case-id>.json    # PASS/FAIL, checks, durationMs, usage, stderr slice
    └── <case-id>.md
```

Per-case markdown includes **Duration** and **Tokens / usage** (from the agent `end` event when the CLI provides `result.usage`).

Also updated when the run finishes:

- `tests/benchmark/reports/frontend-latest.md` (or `backend-…`, `latest` for `--suite all`)

Console output looks like:

```text
[3/70] PASS frontend/medium fe-feature-003-… (12400ms)
  report: …/reports/runs/…/cases/fe-feature-003-….md
```

Open the per-case `.md` immediately when something fails — you do not need to
wait for the full suite.

---

## 10. Filters and options

| Flag | Meaning |
|---|---|
| `--suite all\|frontend\|backend\|cicd\|testing` | Which domain(s) |
| `--difficulty easy\|medium\|hard` | Difficulty within the domain |
| `--mode ask\|plan\|agent` | Mitii mode |
| `--fixture <name>` | Only cases using that fixture |
| `--category <name>` | Frontend category (e.g. `authentication`) |
| `--id <substring>` | Match case id |
| `--limit <n>` | Cap number of cases |
| `--concurrency <n>` | Parallel workers |
| `--keep-workspaces` | Do not delete temp copies |
| `--output <file.json>` | Final “latest” JSON path |
| `--output-dir <dir>` | Reports root (default: `tests/benchmark/reports`) |
| `--dry-run` | Print selection only |
| `--config <path>` | Benchmark config JSON |

List cases without running:

```bash
pnpm --filter @mitii/solid-benchmark list -- --suite frontend --difficulty easy
cd tests/benchmark && npm run list -- --suite testing
```

---

## 11. How a single case runs

1. **Load** the case from `suites/<domain>/cases/<difficulty>.jsonl`
2. **Copy** `fixtures/<fixture>` → `tests/benchmark/.workspaces/<runId>/<case-id>/`; link `node_modules`
3. **Preconditions** — fixture still in the expected baseline state (or fail fast)
4. **Agent** — `mitii-benchmark-agent.mjs` indexes the workspace and runs
   `mitii ask --mode … --approve`
5. **Checks** — deterministic verifiers (`file_*`, `command`, `http`, …)
6. **Report** — write `cases/<id>.md` + refresh live `summary.md`
7. **Cleanup** — delete `.workspaces/<runId>/` unless `--keep-workspaces`

---

## 12. Troubleshooting

| Symptom | Likely cause | What to try |
|---|---|---|
| Echo / empty / stub answers | Model not configured | `mitii setup --show`, set provider/model, re-test with `mitii ask` |
| `module not found` in checks | Fixtures not installed or stale | `pnpm benchmark:reset` (or `pnpm benchmark:fixtures`) |
| Corrupt fixture installs / flaky builds | Stale `node_modules`, locks, or `.next` | `pnpm benchmark:reset` |
| Suite validation failed | Bad/missing case or fixture | `npm run validate -- --suite <domain>` and read errors |
| Agent timeout | Slow model / hard case | Raise `timeoutMs` in `benchmark.config.json` |
| Build check fails after agent | Model didn’t finish the task | Open the per-case report; re-run with `--keep-workspaces` |
| Lockfiles appear in `git status` | Should be ignored | Confirm `.gitignore`; do not commit fixture locks/`node_modules` |
| Wrong model used | Env vs file config | Prefer one approach (setup **or** `MITII_*` **or** config `env`) |

---

## 13. Adding cases

1. Copy `templates/new-case.json`
2. Append one JSON object per line to  
   `suites/<domain>/cases/<difficulty>.jsonl`
3. Update counts in `suites/<domain>/suite.json` if your process requires it  
   (or re-run validation and fix until counts match)
4. `npm run validate -- --suite <domain>`

Details: [docs/ADDING_CASES.md](./docs/ADDING_CASES.md),  
check types: [docs/CHECK_REFERENCE.md](./docs/CHECK_REFERENCE.md).

---

## Package scripts cheat sheet

From **`tests/benchmark`** (`npm run …`) or monorepo **root** (`pnpm …`):

| Root (`pnpm`) | Package (`npm run`) | Action |
|---|---|---|
| `pnpm benchmark:fixtures` | `fixtures:install` | Install all fixture deps |
| `pnpm benchmark:reset` | `fixtures:reset` | Wipe fixtures + temp run workspaces, reinstall |
| `pnpm benchmark:validate` | `validate` | Validate cases |
| — | `suites` | List domains + counts |
| — | `list` | List cases (add filters) |
| `pnpm benchmark` | `benchmark` | Run (`--suite`, `--limit`, …) |
| `pnpm benchmark:frontend` | `benchmark:frontend` | Shortcut `--suite frontend` |
| — | `test` | Harness meta-tests (no LLM) |

You can also call package scripts with
`pnpm --filter @mitii/solid-benchmark <script>`.
