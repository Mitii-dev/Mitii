# Mitii Solid Benchmark

A fixed, deterministic coding-agent benchmark:

- **500 Easy cases**
- **500 Medium cases**
- **500 Hard cases**
- **1,500 total static cases**
- Ask, Plan, and Agent modes
- No task generator
- No LLM-as-judge grading
- Isolated fixture workspace for every run
- Real build/test/syntax commands for every Agent-mode case
- HTTP endpoint checks where the requested result is an API behavior

The suite replaces the previous `manual`, `enterprise`, `eval`, and `generated`
systems with one case model and one runner.

## Case model

Every case contains:

```text
Prompt + Mode + Fixture preconditions + Deterministic checks
```

Example:

```json
{
  "difficulty": "easy",
  "mode": "ask",
  "fixture": "node-express",
  "prompt": "What command runs this project's tests?",
  "preconditions": [
    {
      "type": "file_contains",
      "path": "package.json",
      "value": "node --test"
    }
  ],
  "checks": [
    {
      "type": "output_contains",
      "value": "node --test"
    },
    {
      "type": "workspace_unchanged"
    }
  ]
}
```

For an API implementation, the check starts the server, sends the request, and
validates the real status and body. For a repository fix, the check runs the
actual project test/build command.

## Structure

```text
mitii-benchmark-suite/
├── cases/
│   ├── easy.jsonl             # exactly 500
│   ├── medium.jsonl           # exactly 500
│   └── hard.jsonl             # exactly 500
├── fixtures/                  # pinned repository baselines
├── schema/
│   └── test-case.schema.json
├── src/
│   ├── cli.mjs
│   ├── runner.mjs
│   ├── verifiers.mjs
│   └── report.mjs
├── templates/
│   └── new-case.json
├── docs/
│   ├── ADDING_CASES.md
│   └── CHECK_REFERENCE.md
└── benchmark.config.example.json
```

Only three difficulty levels exist: `easy`, `medium`, and `hard`. There are no
smoke/manual/eval/enterprise tiers.

## Setup

Requires Node.js 20 or newer.

```bash
cd mitii-benchmark-suite
npm run fixtures:install
cp benchmark.config.example.json benchmark.config.json
```

Edit `benchmark.config.json` so `agent.command` and `agent.args` invoke your
headless agent. Available placeholders:

- `{mode}`
- `{prompt}`
- `{workspace}`
- `{id}`
- `{fixture}`

Arguments are passed without a shell, so the prompt is not reparsed as a shell
command.

If `benchmark.config.json` is absent, the runner uses
`benchmark.config.example.json`. The default config runs Mitii via
`scripts/mitii-benchmark-agent.mjs` (indexes the isolated workspace, calls
`apps/cli` as `ask --mode {mode}`, rewrites JSON → JSONL for verifiers).
`agent.cwd` is `../..` (Mitii repo root relative to this package).

For a real agent-mode score, set a provider key (`MITII_API_KEY` /
`ANTHROPIC_API_KEY` / …) and do **not** pass `--echo`. Echo is only for
wiring smoke tests; it will not create the files Agent cases check for.

## Validate before a run

```bash
npm run validate
npm test
```

Validation enforces:

- Exactly 500 cases per difficulty.
- Exactly 1,500 cases total.
- Unique case IDs and family variants.
- Valid modes and fixtures.
- A non-empty prompt and verification list.
- Read-only workspace enforcement for Ask and Plan.
- A real command or HTTP check for every Agent case.

## Run

Full release benchmark:

```bash
npm run benchmark -- --config benchmark.config.json
```

Focused runs:

```bash
npm run benchmark -- --config benchmark.config.json --difficulty easy
npm run benchmark -- --config benchmark.config.json --mode agent --limit 25
npm run benchmark -- --config benchmark.config.json --id build-command
npm run list -- --fixture node-express
```

Useful options:

```text
--difficulty easy|medium|hard
--mode ask|plan|agent
--fixture <name>
--id <substring>
--limit <number>
--concurrency <number>
--keep-workspaces
--output <report.json>
--dry-run
```

## Isolation

Each case receives a fresh copy of its fixture. Changes from one agent run
cannot leak into another case. Before invoking the agent, preconditions confirm
that the fixture still represents the intended broken or unchanged state.

Installed fixture dependencies are linked into the isolated copy and excluded
from mutation scoring. Source, test, configuration, and documentation changes
remain fully visible.

## Release signal

Default gates:

| Difficulty | Required family-weighted score |
|---|---:|
| Easy | 95% |
| Medium | 85% |
| Hard | 70% |
| Overall | 85% |

The result is:

- `GO`: every complete selected difficulty passes its gate.
- `NO-GO`: a complete selected difficulty fails its gate.
- `PARTIAL`: filters or limits produced an incomplete difficulty run.

The report includes raw case score and family-weighted score. Family weighting
prevents repeated prompt phrasings from artificially inflating the signal.

Outputs:

```text
results/latest.json
results/latest.md
```

## Adding a case

No generator is provided. Copy `templates/new-case.json`, edit it, and append
the compact object to one of the three JSONL files. See
`docs/ADDING_CASES.md`.

## What was retained from the old benchmark

The useful repository fixtures and manually designed coding scenarios were
retained. Cases whose expected mutation was already present in a polluted
fixture baseline were excluded. The release contains 359 scenario families
expanded into fixed wording variants for robustness, totaling exactly 1,500
static cases.

Removed:

- Generated task shards.
- Eval task generation.
- Enterprise/manual duplication.
- Old result history.
- Inspect-AI adapter.
- Fixture build output, session logs, and bundled `node_modules`.
