# Release and rollback (Phase 15)

Publish units and CI gates for the Mitii monorepo after packaging (Phases 10–13) and host migration (Phase 15).

## Packages

| Unit | Path | Artifact |
|---|---|---|
| `@mitii/v8` | `packages/v8` | npm (workspace; publish when ready) |
| `@mitii/sdk` | `packages/sdk` | npm over `@mitii/v8` |
| `@mitii/cli` | `apps/cli` | npm bin `mitii` |
| `@mitii/vscode` | `apps/vscode` | VS Code VSIX |

Workspace root `package.json` is **private** and must not ship as the product.

## Version alignment

- Keep `@mitii/v8`, `@mitii/sdk`, `@mitii/cli`, and `@mitii/vscode` on the same semver line when cutting a release (use repo `sync:versions` / package bumps together).
- VSIX `publisher` + extension id live only under `apps/vscode/package.json`.

## Build commands

```bash
pnpm --filter @mitii/v8 build
pnpm --filter @mitii/sdk build
pnpm --filter @mitii/cli build
pnpm --filter @mitii/vscode build
pnpm --filter @mitii/vscode package   # vsce package --no-dependencies
```

Root helpers (thin orchestrator):

```bash
pnpm run build               # v8 + sdk + cli + vscode
pnpm run build:all           # build + Electron native SQLite staged for F5
pnpm run build:vscode        # → @mitii/vscode build
pnpm run build:cli           # → @mitii/cli build
pnpm run package             # → @mitii/vscode package
```

## Required gates before release

Run and record exit codes:

```bash
pnpm run check:architecture
pnpm --filter @mitii/v8 test
pnpm --filter @mitii/sdk test
pnpm --filter @mitii/cli test
pnpm --filter @mitii/cli build && node apps/cli/bin/mitii.js ask "ping" --echo --json
pnpm --filter @mitii/vscode build
```

Do not claim a gate passed unless it actually ran successfully.

## Publish

- **npm:** from each package directory (or `pnpm --filter <name> publish`) after build; respect `private: true` until intentionally opened.
- **VSIX:** `pnpm --filter @mitii/vscode package` then `vsce publish` / `ovsx publish` from `apps/vscode` (or root scripts once they target the app package only).
- Prefer SecretStorage / CI secrets for marketplace tokens — never commit them.

## Rollback

1. **VSIX:** install the previous marketplace/VSIX version; disable auto-update if investigating a regression.
2. **npm:** pin consumers to the prior `@mitii/sdk` / `@mitii/cli` version; do not delete published versions.
3. **Hosts:** production entry points are `apps/cli` and `apps/vscode` only. Do not re-enable legacy `src/kernel` controllers on those paths.
4. Feature flags: optional host settings under `mitii.*` (e.g. `provider.type=echo`) for safe local degrade.

## Legacy

- Phase 16 vaulted obsolete trees under `legacy/`; human purge completed **2026-07-26** (`MITII_PURGE_LEGACY=1 pnpm run legacy:purge`).
- Production hosts and F5 must not recreate or import `legacy/**` / `src/kernel` (architecture tests).
- `scripts/legacy-purge.mjs` remains as a guard (exits non-zero if `legacy/` is already absent).
- Phase 14 owns `tests/` + solid benchmark; old flat `test/` / `tools/benchmark` are gone with the vault.
