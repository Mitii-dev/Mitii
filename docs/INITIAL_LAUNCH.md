# Initial launch (F5) — Phase 17

Status: planned (after Phase 16). Canonical phase text: `packages/v8/ROADMAP.md` Phase 17.

Goal: press **F5** in this monorepo, load **`apps/vscode`**, and verify host ↔ `@mitii/sdk` ↔ `@mitii/v8` wiring before investing in polish or the full solid benchmark.

## Prerequisites

1. Phase 15 complete (hosts exist under `apps/cli`, `apps/vscode`).
2. Phase 16 complete preferred: active tree clean; `mitii.*` only; obsolete code under `legacy/` only.
3. Node ≥ 20, `pnpm` install at repo root.

## One-time build check

```bash
pnpm --filter @mitii/v8 build
pnpm --filter @mitii/sdk build
pnpm --filter @mitii/vscode build
```

Confirm `apps/vscode/dist/extension.js` exists.

## F5 configuration (Phase 17 must ship this)

`.vscode/launch.json` must use:

- `extensionDevelopmentPath`: `${workspaceFolder}/apps/vscode`
- `outFiles`: `${workspaceFolder}/apps/vscode/dist/**/*.js`
- `preLaunchTask`: `mitii: prelaunch`

`.vscode/tasks.json` must build the package chain (`@mitii/v8` → `@mitii/sdk` → `@mitii/vscode`), not the old root `src/extension.ts` / `thunder:*` labels.

**Today (pre–Phase 17):** launch still points at the repo root and `thunder: prelaunch` — that is incorrect after Phase 13 and is the first Phase 17 fix.

## Smoke checklist

In the Extension Development Host:

| # | Check | Pass criteria |
|---|---|---|
| 1 | Activation | Output channel “Mitii”; no crash on activate |
| 2 | Echo provider | `mitii.provider.type=echo` ask completes without API key |
| 3 | Real provider (optional) | SecretStorage / env key path works when configured |
| 4 | `mitii.openChat` | SDK run returns completed / suspended / failed with a clear message |
| 5 | Cancel | Run ends `cancelled` |
| 6 | `mitii.indexWorkspace` | State publish; degraded capabilities OK if honest |
| 7 | Sidebar | WebviewView loads; can trigger ask |
| 8 | Resume | Clarify/approve resume does not replay mutations |
| 9 | Export session | File written; no secrets |
| 10 | No legacy | No load of `legacy/**` or old kernel |

## Failure triage

| Symptom | Likely cause | Fix owner |
|---|---|---|
| “No extension” / empty contributes | F5 pointed at repo root | Phase 17 launch.json |
| Cannot find module `@mitii/sdk` | Workspace deps / build order | prelaunch tasks |
| Activate throws | ports composition / missing dist | `apps/vscode` build + `ports.ts` |
| Ask hangs | LLM port / cancel token | SDK client + hostAsk |
| Index lies “ready” | capability honesty | repository-state publish path |

## Out of scope for first launch

- Full React webview UI
- Daemon / channels / board
- Full 1,500-case solid benchmark GO gate (Phase 14)
- Running `pnpm run legacy:purge` (human-only when ready)

## Related

- `packages/v8/ROADMAP.md` — Phase 17
- `docs/REPO_LAYOUT.md` — package boundaries
- `docs/RELEASE.md` — publish units
- `legacy/DELETE.md` — one-click purge (created in Phase 16)
