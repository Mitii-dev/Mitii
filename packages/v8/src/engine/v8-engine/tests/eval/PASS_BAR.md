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
- Nightly live/recorded: `pnpm --filter @mitii/v8 run eval:nightly`

Promotion references this catalog via `V8_ENGINE_PROMOTION.curatedCatalogPath`.
