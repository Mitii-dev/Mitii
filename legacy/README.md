# Legacy vault

**Frozen reference only.** Not a production entry point. Not in the pnpm workspace. Not in CI.

After **Phase 16**, all obsolete Mitii trees belong **only** under this folder:

| Path | Contents |
|---|---|
| `legacy/src/` | Old monorepo kernel / VS Code / webview / composition (from repo-root `src/`) |
| `legacy/packages/` | Quarantined daemon / channels / board / old CLI shells |
| `legacy/test/` | Old flat tests that import kernel controllers (broken for V8) |
| `legacy/tools-benchmark/` | Superseded by solid `benchmark/` (moves to `tests/benchmark` in Phase 14) |
| `legacy/bin/`, `legacy/media/`, `legacy/scripts/`, `legacy/project-goals/` | Dead root tooling, media, and scratch notes |
| `legacy/ARCHITECTURE.root.md` | Obsolete root architecture doc (canonical: `packages/v8/ARCHITECTURE.md`) |
| `legacy/vite.config.ts` | Root Vite webview build (webview-ui lives under `legacy/src/`) |

## Rules

1. Do **not** import anything from `legacy/**` into `packages/*` or `apps/*`.
2. Do **not** add features here.
3. Do **not** run these trees in F5 or release packaging.
4. New solid benchmark lives at repo-root `benchmark/` until Phase 14 moves it to `tests/benchmark/` — never under this vault.

## One-click delete (when you are ready)

See [`DELETE.md`](./DELETE.md). From the repo root:

```bash
MITII_PURGE_LEGACY=1 pnpm run legacy:purge
```

Until you run that, keeping this folder is intentional: a clean active tree with a single place left to erase.

Phase ownership: **Phase 16** creates/completes this vault; purge is optional and human-gated.
