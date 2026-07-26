# Tests and solid benchmark (Phase 14)

Status: planned (after Phase 16 vault + Phase 17 F5). Canonical phase text: `packages/v8/ROADMAP.md` Phase 14.

## Target tree

```text
tests/
├── package.json              # optional @mitii/tests orchestrator
├── reports/                  # latest.json / latest.md / run artifacts
├── benchmark/                # @mitii/solid-benchmark (moved from repo-root benchmark/)
├── packages/
│   ├── v8/                   # consumer tests — public @mitii/v8 only
│   └── sdk/                  # consumer tests — public @mitii/sdk only
├── architecture/
├── contract/
├── integration/
└── e2e/
```

## What happens to old tests

| Old surface | Fate |
|---|---|
| `test/**` (kernel / HeadlessAgentHost / …) | Phase 16 → `legacy/test/` then **purged**; **not** ported |
| `tools/benchmark` (~490M old system) | Phase 16 vault then **purged**; replaced by solid suite |
| Repo-root `benchmark/` (solid, 1500 cases) | Phase 14 → `tests/benchmark/` |
| Co-located `packages/v8/**/tests/*.spec.ts` | **Keep** in package (module ownership) |

## Solid benchmark

- Package: `@mitii/solid-benchmark`
- Cases: 500 easy + 500 medium + 500 hard (fixed JSONL; no generator)
- Agent command must invoke **`apps/cli`** (`mitii`), not legacy `dist/cli.js`
- Reports → `tests/reports/` (convention fixed in Phase 14)
- Full GO/NO-GO gates are a **release** signal; PR CI may run `validate` + `--limit` smoke

## Scripts (target)

```bash
pnpm --filter @mitii/solid-benchmark validate
pnpm --filter @mitii/solid-benchmark test
pnpm --filter @mitii/solid-benchmark benchmark -- --limit 25
pnpm --filter @mitii/v8 test
pnpm --filter @mitii/sdk test
# after layout exists:
pnpm --filter @mitii/tests test   # or root wrappers into tests/packages/*
```

## Rules

- Prefer `@mitii/sdk` / public `@mitii/v8` entry points.
- Never import purged `legacy/**` paths.
- Never keep two active benchmark systems.
- Do not block Phase 16/17 on the full 1500-case gate.
