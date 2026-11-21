# Curated-40 pass bar

Nightly / manual product eval catalog: `curated-40.json` (exactly 40 prompts).

## Catalog rules (CI-locked)

- `passBar.forbidContinueOnlyPassWhenMutationRequired: true` — a run that only hits host Continue without a required mutation **fails**.
- `passBar.noLivePaidApisInUnitCi: true` — unit CI uses stub LLMs only; live/recorded evals are nightly/manual.
- Every prompt sets `passBar.acceptContinueWithoutMutation: false`.

## Per-prompt bar

| Field | Meaning |
|-------|---------|
| `mutationRequired` | Execute-path tasks must apply a mutation (or correctly ask) before pass. |
| `acceptContinueWithoutMutation` | Always `false` in this catalog. |
| `notes` | Human grader / harness hint. |

## How to run

- Always-on goldens (stub): `pnpm --filter @mitii/v8 run test:v8-engine`
- Catalog integrity: same suite (`tests/eval/curated-40.spec.ts`)
- Nightly (catalog + goldens only, no API): `pnpm --filter @mitii/v8 run eval:nightly`
- Live curated-40 (opt-in, needs provider env and `pnpm --filter @mitii/cli build`):
  `pnpm --filter @mitii/v8 run eval:live`, or
  `MITII_LIVE_EVAL=1 npx vitest run src/engine/v8-engine/tests/eval/curated-40.live.spec.ts`.
  Each prompt runs `mitii run --auto … --timeout <s>` in a fresh temp workspace.
  Mutation-required prompts pass only when the CLI exits 0 **and** the workspace
  changed (no Continue-only green). Narrow with `MITII_LIVE_EVAL_IDS`,
  `MITII_LIVE_EVAL_BUCKET`, `MITII_LIVE_EVAL_LIMIT`; tune with
  `MITII_LIVE_EVAL_TIMEOUT_SECONDS` (default 300) and `MITII_LIVE_EVAL_CLI`.
  Without `MITII_LIVE_EVAL=1` the live block is skipped and only catalog and
  grading helpers run.

Promotion references this catalog via `V8_ENGINE_PROMOTION.curatedCatalogPath`.
