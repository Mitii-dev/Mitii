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
`npm run build`, HTTP, etc.). There is no LLM-as-judge.

Domains (each with easy / medium / hard):

| Domain | What it exercises |
|---|---|
| `frontend` | UI, React/Next, styling, a11y, client features |
| `backend` | APIs, services, bugfixes, retrieval, planning |
| `cicd` | Workflows, pipelines, deploy automation |
| `testing` | Unit/integration/e2e, coverage, regression |

After **every** case finishes, a report is written immediately under
`benchmark/reports/runs/<runId>/cases/` (not only at the end of the suite).

## Quick start (short path)

All commands assume the **Mitii repo root** unless noted.

```bash
# 1) Install fixture dependencies (once, or after fixture changes)
pnpm benchmark:fixtures

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

For the full step-by-step (fixtures, cleanup, model setup, filters, reports,
troubleshooting), open:

**[tests/benchmark/README.md](./benchmark/README.md)**

## Scripts from this folder

From repo root (`pnpm`) or via `tests/package.json`:

| Script | Purpose |
|---|---|
| `pnpm benchmark:validate` | Validate all domain case files |
| `pnpm benchmark:fixtures` | Install `node_modules` inside each fixture |
| `pnpm benchmark:frontend` | Run the frontend domain |
| `pnpm benchmark:backend` | Run the backend domain |
| `pnpm benchmark:cicd` | Run the CI/CD domain |
| `pnpm benchmark:testing` | Run the testing domain |
| `pnpm benchmark -- …` | Forward extra flags to the runner |

Equivalent from `tests/benchmark`:

```bash
cd tests/benchmark
npm run fixtures:install
npm run validate
npm run benchmark -- --suite frontend --limit 3
```

## Requirements

- Node.js **20+**
- Repo dependencies installed (`pnpm install` at monorepo root)
- A configured Mitii model provider (local Ollama or a cloud API)
- Fixture installs completed before agent runs that execute `npm test` / `npm run build`
