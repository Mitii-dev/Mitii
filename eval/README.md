# Mitii External Evaluation (500–1000 tasks)

Large-scale agent potential assessment **outside the VS Code extension**. Generated tasks and fixtures are **not shipped in the `.vsix`** (see `.vscodeignore`).

## What this measures

| Category | Tests Mitii's… |
|----------|----------------|
| `fixture-ask` | Code retrieval & Q&A on JS/TS stacks |
| `fixture-plan` | Structured planning on real repos |
| `fixture-agent` | Tool loop, skills, safe inspection |
| `coding-js` | Algorithm & JS knowledge |
| `reasoning` | Engineering judgment |
| `tool-calling` | Tool schema / MCP awareness |
| `gaia` | Multi-step & factual reasoning |
| `base-*` | Original 26 enterprise benchmark tasks |

## Quick start (free, local)

```bash
cd mitii-ai-agent
npm run compile:cli

# Real-runtime eval needs Node ABI sqlite (not Electron-only rebuild)
npm run eval:preflight    # auto-rebuilds better-sqlite3 for Node if needed

# Generate 500 tasks (auto-run by eval:standard if missing/stale)
npm run eval:generate

# Smoke: 3 tasks with echo/stub ($0)
npm run eval:smoke

# Standard: 500 tasks (set model for real eval)
npm run eval:standard -- --provider openai-compatible \
  --base-url http://localhost:11434/v1 --model qwen3-coder:30b --limit 50
```

## Profiles

| Profile | Tasks | Use |
|---------|------:|-----|
| `smoke` | 3 | CI / wiring |
| `standard` | 500 | Regular potential check |
| `full` | 1000 | Full assessment |
| `coding` | 300 | No fixtures |
| `fixtures` | 400 | Repo-heavy |

```bash
node eval/scripts/generate-tasks.mjs --profile full
node eval/scripts/generate-tasks.mjs --count 750
```

## Parallel sharded runs

```bash
# 4 shards, 4 workers each
for i in 1 2 3 4; do
  node eval/scripts/run-eval.mjs --shard $i/4 --concurrency 4 \
    --output eval/results/shard-$i.json &
done
wait
node eval/scripts/aggregate-results.mjs --input eval/results
```

## Ollama model matrix (free)

```bash
ollama serve   # terminal 1
bash eval/scripts/ollama-matrix.sh   # terminal 2
```

## Inspect AI (optional orchestrator)

```bash
pip install -r eval/inspect-ai/requirements.txt
export MITII_PACKAGE_ROOT=$(pwd)
inspect eval eval/inspect-ai/eval_tasks.py::mitii_eval_smoke
```

For production eval with a live model, use `mitii_eval_standard` and set provider env vars in the solver.

## Reports

- Per run: `.mitii/eval/report.json` + `.md`
- Aggregated: `eval/results/aggregated-report.json` with **potential tier**:
  - `enterprise-ready` (≥85% overall, ≥70% agent)
  - `production-capable` (≥70%)
  - `promising` (≥50%)
  - `developing` (<50%)

## Architecture

```text
eval/                          # NOT in VSIX
  scripts/
    generate-tasks.mjs         # 500–1000 task factory
    run-eval.mjs               # Parallel runner
    aggregate-results.mjs      # Potential assessment
    ollama-matrix.sh           # Free model comparison
  tasks/generated/             # Gitignored shards
  inspect-ai/                  # Python Inspect AI adapter
  datasets/                    # Seed catalogs
  config/profiles.json

benchmark/                     # Original 26-task harness (also excluded from VSIX)
```

Mitii CLI (`dist/cli.js`) + `HeadlessAgentHost` remain the **agent runtime**. This layer is the **evaluation operating system**.

## CI

PR CI keeps `benchmark:smoke` (3 tasks). Full eval runs manually or in a nightly workflow — not on every PR.

```bash
npm run eval:smoke
```

## Node vs Electron native modules

| Command | Rebuilds for | Used by |
|---------|--------------|---------|
| `npm run rebuild:native` | VS Code/Cursor Electron | Extension F5 |
| `npm run rebuild:node` | System Node.js | CLI eval, tests |
| `npm run rebuild:all` | Both | Dev machines doing F5 + eval |

If eval fails instantly with `NODE_MODULE_VERSION` in stderr, run `npm run eval:preflight` or `npm run rebuild:node`.
