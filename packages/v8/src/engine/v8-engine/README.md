# V8 Engine

Thin run orchestrator — **default** beside `agent-engine` (legacy fallback).

**Plan:** `project-goals/v8-engine-rewrite-plan.md` · **Promotion:** [`PROMOTION.md`](./PROMOTION.md)

## Status

| Piece | Status |
|-------|--------|
| Thin loop + discipline | done |
| Host opt-in / compose switch | done |
| Default implementation | **`v8`** (legacy selectable) |
| Always-on goldens (§7.2) | done |
| Curated-40 catalog | done |
| Nightly eval workflow | done |
| Shaped discovery profiles | done (incl. monorepo / security / testing) |
| Mutation critic | done (`steering.criticMode`) |
| Progressive INDEX stubs | done (`filterToolDefinitions`) |
| Policy lab v8 knobs | done (`pnpm policy-admin` + `v8LoopPolicy`) |

## Usage

```ts
import { composeAgentEngine, createMitiiClient } from "@mitii/sdk";

// Default is v8 after Phase 5:
createMitiiClient({ understandingLlm, runLlm });

// Explicit legacy fallback:
createMitiiClient({
  understandingLlm,
  runLlm,
  engineImplementation: "legacy",
});
```

**Setting:** `mitii.engine.implementation` = `v8` | `legacy` (default **`v8`**).  
Do not resume a run after flipping.

**V8 knobs:** ship bands in `policy/bands.ts` (edit via `pnpm policy-admin`). Local Custom: `mitii.v8LoopPolicy.*`.

**Mutation critic:** `steering: { criticMode: "off" | "shadow" | "enforce" }` (default off).

## Eval

- Always-on: `pnpm --filter @mitii/v8 run test:v8-engine`
- Nightly: `pnpm --filter @mitii/v8 run eval:nightly`
- Catalog: `tests/eval/curated-40.json`

## Rules

See rewrite plan §2.1 (no peer names in source; ≤600 lines/file; proper constants/contracts).
