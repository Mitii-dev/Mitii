# Release and rollback

Publish units and CI gates for the Mitii monorepo.

## Packages

| Unit | Path | Artifact | Status |
|---|---|---|---|
| `@mitii/v8` | `packages/v8` | npm | Published on release (`publishConfig.access: public`) |
| `@mitii/sdk` | `packages/sdk` | npm over `@mitii/v8` | Published on release |
| `@mitii/host` | `packages/host` | npm over sdk/v8 | Published on release |
| `@mitii/cli` | `apps/cli` | npm bin `mitii` | Published on release |
| `mitii-ai-agent` (VS Code) | `apps/vscode` | VSIX | Multi-platform VSIX via Release workflow — Marketplace id `mitii.mitii-ai-agent` |

Workspace root `package.json` is **private** and must not ship as the product.

## Version alignment

- Keep `@mitii/v8`, `@mitii/sdk`, `@mitii/host`, `@mitii/cli`, and the VS Code extension on the same semver line when cutting a release (`pnpm run sync:versions` / `pnpm run version:*`).
- CI and release workflows run `pnpm run sync:versions -- --check` and fail on drift.
- VSIX `publisher` + extension id live only under `apps/vscode/package.json`.

## Build commands

```bash
pnpm run build               # v8 + sdk + host + cli + vscode
pnpm run build:all           # build + Electron native SQLite staged for F5
pnpm run build:vscode        # extension only
pnpm run build:cli           # CLI only
pnpm run package             # VSIX via apps/vscode (target from MITII_VSCODE_TARGET or local)
```

## Required gates before release

```bash
pnpm run sync:versions -- --check
pnpm run check:architecture
pnpm run typecheck
pnpm test
pnpm run build:cli
node apps/cli/bin/mitii.js ask "ping" --echo --json
pnpm run build:vscode
pnpm run package
```

Do not claim a gate passed unless it actually ran successfully.

## GitHub Actions secrets

Add these under **Settings → Secrets and variables → Actions** (values are never committed):

| Secret | Required | Purpose |
|---|---|---|
| `NPM_TOKEN` | Optional fallback | npm granular access token with publish rights for `@mitii/*` and bypass 2FA enabled when trusted publishing is not configured |
| `VSCE_PAT` | Yes (marketplace job) | Azure DevOps PAT with Marketplace publish scope for publisher `mitii` |
| `OVSX_PAT` | Optional | Open VSX token; Open VSX publish is skipped when unset |

## Publish

### Cut a release tag

1. Bump and align versions: `pnpm run version:patch` (or `minor` / `major`), or bump root then `pnpm run sync:versions` + `pnpm run readme:sync-version`.
2. Commit, then tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The **Release** workflow (`.github/workflows/release.yml`) will:
   - Build native VSIXs for `darwin-arm64`, `darwin-x64`, `linux-x64`, `win32-x64`
   - Attach them to a GitHub Release
   - Publish all four targets to the VS Code Marketplace (`VSCE_PAT`)
   - Publish to Open VSX when `OVSX_PAT` is set
   - Call **npm publish** for `@mitii/v8` → `@mitii/sdk` → `@mitii/host` → `@mitii/cli` (GitHub OIDC trusted publishing, with `NPM_TOKEN` fallback)

### npm authentication

The npm publish workflow runs on Node 22 and installs npm CLI 11.5.1+ so GitHub OIDC trusted publishing can be used. On npmjs.com, configure a trusted publisher for each package (`@mitii/v8`, `@mitii/sdk`, `@mitii/host`, `@mitii/cli`) with:

- Owner: `Mitii-dev`
- Repository: `Mitii`
- Workflow filename: `release.yml` for tag releases

The npm docs validate the caller workflow when a reusable workflow is invoked with `workflow_call`, so tag releases authenticate as `.github/workflows/release.yml` even though the publish steps live in `.github/workflows/npm-publish.yml`. If you need to run the standalone **npm publish** workflow manually with trusted publishing, switch the package trusted publisher workflow filename to `npm-publish.yml` for that run, or use the `NPM_TOKEN` fallback.

If using the `NPM_TOKEN` fallback instead, create a granular access token with package publish access and enable bypass 2FA. Tokens without bypass 2FA will fail in CI with `EOTP` because GitHub Actions cannot supply an interactive authenticator code.

### Local / manual

```bash
# npm packages (requires NODE_AUTH_TOKEN or NPM_TOKEN)
pnpm run build:v8 && pnpm run build:sdk && pnpm run build:host && pnpm run build:cli
pnpm run publish:npm

# VSIX → Marketplace (expects complete set under dist-vsix/)
pnpm run package   # per platform / runner
pnpm run publish:vsce
pnpm run publish:ovsx   # no-op without OVSX_PAT
```

Manual multi-platform VSIX artifacts without publishing: run **VS Code native VSIX** (`.github/workflows/native-binaries.yml`) via `workflow_dispatch`.

## Rollback

1. **VSIX:** install the previous marketplace/VSIX version; disable auto-update if investigating a regression.
2. **npm:** pin consumers to the prior version; do not delete published versions.
3. **Hosts:** production entry points are `apps/cli` and `apps/vscode` only.
4. Feature flags: optional host settings under `mitii.*` (e.g. `provider.type=echo`) for safe local degrade.

## Legacy

- Obsolete trees under `legacy/` were purged. Do not reintroduce `legacy/**` or vaulted kernel paths into product packages (architecture tests).
