# Release and rollback

Publish units and CI gates for the Mitii monorepo.

## Packages

| Unit | Path | Artifact | Status |
|---|---|---|---|
| `@mitii/v8` | `packages/v8` | npm workspace | **`private: true`** — not published |
| `@mitii/sdk` | `packages/sdk` | npm over `@mitii/v8` | **`private: true`** — not published |
| `@mitii/cli` | `apps/cli` | npm bin `mitii` | **`private: true`** — not published |
| `mitii-agent` (VS Code) | `apps/vscode` | VSIX | **Ship path** via Release workflow |

Workspace root `package.json` is **private** and must not ship as the product.

## Version alignment

- Keep `@mitii/v8`, `@mitii/sdk`, `@mitii/cli`, and the VS Code extension on the same semver line when cutting a release (`pnpm run sync:versions` / package bumps together).
- VSIX `publisher` + extension id live only under `apps/vscode/package.json`.

## Build commands

```bash
pnpm run build               # v8 + sdk + cli + vscode
pnpm run build:all           # build + Electron native SQLite staged for F5
pnpm run build:vscode        # extension only
pnpm run build:cli           # CLI only
pnpm run package             # VSIX via apps/vscode
```

## Required gates before release

```bash
pnpm run check:architecture
pnpm run typecheck
pnpm test
pnpm run build:cli
node apps/cli/bin/mitii.js ask "ping" --echo --json
pnpm run build:vscode
pnpm run package
```

Do not claim a gate passed unless it actually ran successfully.

## Publish

- **npm:** deferred while packages are `private: true`. The `npm publish` workflow is intentionally a no-op guard. Remove `private` and restore a real publish job only when you intend to open the packages.
- **VSIX:** `pnpm run package` then `pnpm run publish:vsce` / `pnpm run publish:ovsx`, or cut a `v*` tag to run `.github/workflows/release.yml`.
- Prefer SecretStorage / CI secrets for marketplace tokens — never commit them.

## Rollback

1. **VSIX:** install the previous marketplace/VSIX version; disable auto-update if investigating a regression.
2. **npm:** N/A while packages remain private. After a future public release, pin consumers to the prior version; do not delete published versions.
3. **Hosts:** production entry points are `apps/cli` and `apps/vscode` only.
4. Feature flags: optional host settings under `mitii.*` (e.g. `provider.type=echo`) for safe local degrade.

## Legacy

- Obsolete trees under `legacy/` were purged. Do not reintroduce `legacy/**` or vaulted kernel paths into product packages (architecture tests).
