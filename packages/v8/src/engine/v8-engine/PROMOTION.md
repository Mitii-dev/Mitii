# V8 Engine promotion (Phase 5)

**Status:** `promoted` — `v8` is the default orchestrator; `legacy` remains selectable for one release as fallback.

## Defaults

| Surface | Default | Fallback |
|---------|---------|----------|
| `composeAgentEngine()` | `v8` | `implementation: "legacy"` |
| `createMitiiClient()` | `v8` | `engineImplementation: "legacy"` |
| `mitii.engine.implementation` | `v8` | `legacy` |
| `MITII_ENGINE_IMPLEMENTATION` | `v8` | `legacy` |

Constant: `V8_ENGINE_PROMOTION` in `packages/v8/src/engine/v8-engine/promotion.ts`.

## Always-on goldens (unit CI)

Path: `packages/v8/src/engine/v8-engine/tests/` (includes `eval/alwaysOn.goldens.spec.ts`).

Covers rewrite-plan §7.2 scenarios with **stub LLMs only** (no live paid APIs).

## Curated-40

Catalog: `packages/v8/src/engine/v8-engine/tests/eval/curated-40.json`  
Source: `project-goals/agent-engine-test-prompts.md`

**Pass bar:** mutation completed or correct ask answer; never mark green on Continue alone when mutation was required.

Nightly: `pnpm --filter @mitii/v8 run eval:nightly` (also `.github/workflows/v8-engine-eval.yml`).

Live/recorded product runs against the 40 prompts are optional drivers — not unit CI.

## Soak

`soakDaysRequired: 7` — keep watching always-on goldens + nightly. Rollback anytime:

```bash
# env
MITII_ENGINE_IMPLEMENTATION=legacy

# setting
mitii.engine.implementation = legacy

# compose
composeAgentEngine({ implementation: "legacy", ... })
```

## Do not

- Resume a run after flipping implementations (no cross-engine resume guarantee).
- Weaken product tests to make the agent look green.
- Call live paid APIs from unit CI.
