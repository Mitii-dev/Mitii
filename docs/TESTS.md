# Tests

## Layout

Package and architecture tests live next to their owners:

```text
packages/v8/tests/architecture/   # module boundary rules
packages/v8/tests/smoke/          # public @mitii/v8 consumer smoke
packages/sdk/tests/               # SDK contract + smoke
apps/vscode/tests/                # VS Code extension unit tests
packages/v8/src/**/tests/         # co-located module specs
```

`tests/` is **benchmark-only**:

```text
tests/
├── README.md                 # short overview + quick start
├── package.json              # forwards to @mitii/solid-benchmark
└── benchmark/
    └── README.md             # full install / run / cleanup guide
```

## Package tests

```bash
pnpm test
pnpm run check:architecture
```

## Solid benchmark

Start here:

1. [tests/README.md](../tests/README.md) — overview  
2. [tests/benchmark/README.md](../tests/benchmark/README.md) — step-by-step  
   (fixtures install & cleanup, model setup, run options, reports)

```bash
pnpm benchmark:fixtures
pnpm benchmark:validate
pnpm benchmark:frontend
```

Fixture `node_modules` / lockfiles are gitignored. Reports write per-case under
`tests/benchmark/reports/runs/<runId>/cases/`.
