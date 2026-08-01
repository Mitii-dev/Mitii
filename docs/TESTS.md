# Tests and solid benchmark (Phase 14)

Status: in progress (layout landed 2026-07-26). Canonical phase text: `packages/v8/ROADMAP.md` Phase 14.

## Target tree

```text
tests/
├── package.json              # @mitii/tests orchestrator
├── reports/                  # latest.json / latest.md / run artifacts
├── benchmark/                # @mitii/solid-benchmark (from former repo-root benchmark/)
├── packages/
│   ├── v8/                   # consumer tests — public @mitii/v8 only
│   └── sdk/                  # consumer tests — public @mitii/sdk only
├── architecture/
├── contract/
├── integration/
└── e2e/
```

## What happened to old tests

| Old surface | Fate |
|---|---|
| `test/**` (kernel / HeadlessAgentHost / …) | Phase 16 → purged; **not** ported |
| `tools/benchmark` (~490M old system) | Phase 16 purged; replaced by solid suite |
| Repo-root `benchmark/` (solid, 1500 cases) | **Moved** → `tests/benchmark/` |
| Co-located `packages/v8/**/tests/*.spec.ts` | **Keep** in package (module ownership) |

## Solid benchmark

- Package: `@mitii/solid-benchmark`
- Cases: 500 easy + 500 medium + 500 hard (fixed JSONL; no generator)
- Agent command must invoke **`apps/cli`** (`mitii`), not legacy `dist/cli.js`
- Reports → `tests/reports/` by default (`--output` still overrides)
- Language fixtures stay under `tests/benchmark/fixtures` (single home)
- Full GO/NO-GO gates are a **release** signal; PR CI may run `validate` + `--limit` smoke

## Scripts

```bash
pnpm --filter @mitii/solid-benchmark validate
pnpm --filter @mitii/solid-benchmark test
pnpm --filter @mitii/solid-benchmark benchmark -- --limit 25
pnpm run check:architecture
pnpm --filter @mitii/v8 test
pnpm --filter @mitii/sdk test
pnpm test   # root vitest: architecture + consumer packages + selected v8 suites
```

## Rules

- Prefer `@mitii/sdk` / public `@mitii/v8` entry points.
- Never import purged `legacy/**` paths.
- Never keep two benchmark systems.
- Do not block Phase 16/17 on the full 1500-case gate.
