# Initial launch (F5)

Press **F5** in this monorepo to load `apps/vscode` and verify host -> `@mitii/sdk` -> `@mitii/v8`.

## Prerequisites

- Node.js >= 20, pnpm 10.13+
- Repo root opened in VS Code or Cursor

```bash
pnpm run setup            # VS Code
# or
pnpm run setup:cursor     # Cursor on macOS
```

Confirm `apps/vscode/dist/extension.js` exists (setup/build creates it).

## Launch config

`.vscode/launch.json` must use:

- `extensionDevelopmentPath`: `${workspaceFolder}/apps/vscode`
- `outFiles`: `${workspaceFolder}/apps/vscode/dist/**/*.js`
- `preLaunchTask`: builds v8 -> sdk -> host -> vscode

## Smoke checklist

In the Extension Development Host:

| # | Check | Pass criteria |
|---|---|---|
| 1 | Activation | Output channel "Mitii"; no activate crash |
| 2 | Echo provider | `mitii.provider.type=echo` ask completes without API key |
| 3 | Real provider (optional) | SecretStorage / env key works when configured |
| 4 | Open Chat | Ask run completes / suspends / fails with a clear message |
| 5 | Cancel | Run ends `cancelled` |
| 6 | Index Workspace | State publish; degraded capabilities OK if honest |
| 7 | Sidebar | Webview loads; can trigger ask |
| 8 | Generate Commit Message | Fills SCM input (attaches `git-commit-message`) |
| 9 | Export session | File written; no secrets |

## Automated gate (no Extension Host)

```bash
pnpm run verify:launch
```

## Native SQLite note

F5 needs the Electron ABI staged into `apps/vscode/dist/native`:

```bash
pnpm run rebuild:native
# Cursor:
MITII_EDITOR=cursor pnpm run rebuild:native
```

Vitest/CLI use the Node ABI in `node_modules` (`pnpm run rebuild:node` if needed).

## Related

- [`docs/REPO_LAYOUT.md`](REPO_LAYOUT.md)
- [`docs/RELEASE.md`](RELEASE.md)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- [`apps/vscode/README.md`](../apps/vscode/README.md)
