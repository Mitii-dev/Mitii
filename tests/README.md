# Mitii `tests/`

This folder is **benchmark-only**.

Unit, architecture, and package tests live next to their owners
(`packages/v8/tests`, `packages/sdk/tests`, `apps/vscode/tests`, …).
What remains here is the solid coding-agent evaluation suite.

```text
tests/
├── README.md                 ← you are here (overview)
├── package.json              ← thin scripts that forward to the benchmark package
└── benchmark/                ← full suite (cases, fixtures, runner, reports)
    └── README.md             ← detailed how-to (install, run, clean up)
```

## What the benchmark does

It measures how well Mitii performs as a coding agent on **pinned fake repositories**
(fixtures), using **fixed prompts** and **deterministic checks** (file contents,
`npm run build`, HTTP, direct class instantiation, etc.). There is no LLM-as-judge.

**Agent mode only, for now.** Every case in every domain has `mode: "agent"`.
`ask` and `plan` mode cases will be added later.

Domains — each organized into **category files** (the JSONL file name tells you
the tech-family or cross-cutting theme, not a difficulty bucket; `difficulty`
easy/medium/hard is just a field mixed freely within each file):

| Domain | Cases | Category files |
|---|---:|---|
| `frontend` | 85 | `feature`, `bugfix`, `docs`, `retrieval`, `testing`, `capstone` |
| `backend` | 44 | `nest`, `saas-api`, `express`, `monorepo`, `robustness`, `auth` |
| `testing` | 23 | `express`, `monorepo`, `react` |
| `cicd` | 18 | `react`, `nest`, `express`, `monorepo` |

**170 cases total.** Run `pnpm --filter @mitii/solid-benchmark suites` (or
`cd tests/benchmark && npm run suites`) any time for live, authoritative counts —
the table above will drift as cases are added, that command never will.

`frontend/cases/capstone.jsonl` is a special category: instead of modifying an
existing fixture, the agent builds a **complete small application** from a
near-blank scaffold (a welcome website, tic-tac-toe, Sudoku, a chess
move-validator), graded by a pristine oracle test suite plus a full build.

After **every** case finishes, a report is written immediately under
`benchmark/reports/runs/<runId>/cases/` (not only at the end of the suite).

## Browse cases before you run anything

A **read-only** test case browser lets you filter/search all 170 cases by
suite, category file, difficulty, capability, and fixture — useful both to see
what's already covered and to find the right file when adding a new case:

```bash
pnpm --filter @mitii/solid-benchmark cases:open
# or: cd tests/benchmark && npm run cases:open
```

It has no edit capability by design — it's a viewer, not an editor.

## Quick start (short path)

All commands assume the **Mitii repo root** unless noted.

```bash
# 1) Install fixture dependencies (once, or after fixture changes)
pnpm benchmark:fixtures

#    To wipe node_modules / lockfiles / build outputs and reinstall everything:
#    pnpm benchmark:reset

# 2) Configure a real model (Ollama, Anthropic, OpenAI-compatible, …)
#    See tests/benchmark/README.md → “Configure a model”
node apps/cli/bin/mitii.js setup --show

# 3) Validate case files
pnpm benchmark:validate

# 4) Run a small smoke (one domain, few cases)
pnpm --filter @mitii/solid-benchmark benchmark -- \
  --suite frontend \
  --limit 3 \
  --config tests/benchmark/benchmark.config.json
```

For the full step-by-step (fixtures, reset/cleanup, model setup, filters, reports,
troubleshooting, the test case browser), open:

**[tests/benchmark/README.md](./benchmark/README.md)**

## Scripts from this folder

From repo root (`pnpm`) or via `tests/package.json`:

| Script | Purpose |
|---|---|
| `pnpm benchmark:validate` | Validate all domain case files |
| `pnpm benchmark:fixtures` | Install `node_modules` inside each fixture |
| `pnpm benchmark:reset` | Wipe fixture installs/build outputs, then reinstall all |
| `pnpm benchmark:frontend` | Run the frontend domain |
| `pnpm benchmark:backend` | Run the backend domain |
| `pnpm benchmark:cicd` | Run the CI/CD domain |
| `pnpm benchmark:testing` | Run the testing domain |
| `pnpm benchmark -- …` | Forward extra flags to the runner |
| `pnpm benchmark:view` / `:view:open` | Open the HTML run viewer |

Not yet forwarded from this folder's `package.json` (call via
`--filter @mitii/solid-benchmark`, or `cd tests/benchmark`):

| Script | Purpose |
|---|---|
| `cases` / `cases:open` | Read-only test case browser |
| `suites` | List domains + live category/difficulty counts |
| `list` | List cases with filters, no run |
| `test` | Harness meta-tests (no LLM) |

Equivalent from `tests/benchmark`:

```bash
cd tests/benchmark
npm run fixtures:install   # or: npm run fixtures:reset
npm run validate
npm run cases:open         # test case browser
npm run benchmark -- --suite frontend --limit 3
```

## Requirements

- Node.js **20+**
- Repo dependencies installed (`pnpm install` at monorepo root)
- A configured Mitii model provider (local Ollama or a cloud API)
- Fixture installs completed before agent runs that execute `npm test` / `npm run build`
  — fixtures cannot install new packages mid-case, so every dependency a case
  might need is already committed as a fixture `devDependency`
