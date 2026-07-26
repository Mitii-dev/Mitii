# Legacy `src/` (frozen reference — pre–Phase 16)

This tree is **not** a production entry point after Phase 13/15.

- Production hosts: `apps/cli`, `apps/vscode` via `@mitii/sdk` → `@mitii/v8`
- Do not add features here
- Do not import into `@mitii/v8`
- **Phase 16** moves this entire tree into `legacy/src/` (single vault) and adds one-click purge (`legacy/DELETE.md`)
- Do not start Phase 14/17 while this still sits at the repo root as an active-looking tree

See `packages/v8/ROADMAP.md` Phase 16, `legacy/README.md`, `docs/REPO_LAYOUT.md`.
