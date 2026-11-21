# Tests

Package and architecture tests live next to their owners. Root `tests/` is **benchmark-only**.

```text
packages/v8/tests/architecture/   # module boundary rules
packages/*/…/tests/               # co-located unit / contract / integration
apps/vscode/tests/                # extension unit tests
tests/benchmark/                  # @mitii/solid-benchmark
scripts/github-actions/*.test.js  # CI review poster
```

```bash
pnpm test
pnpm run check:architecture
pnpm run benchmark:validate
pnpm run benchmark:prepare   # wipe + reinstall fixture deps
pnpm run benchmark           # full run (see tests/benchmark/README.md)
```

Suite shortcuts (`benchmark:frontend`, etc.) live on `@mitii/solid-benchmark` / `tests/package.json`.
