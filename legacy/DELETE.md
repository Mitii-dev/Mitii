# Delete the legacy vault (one click)

When you are ready to permanently remove all frozen legacy code:

```bash
# from monorepo root
MITII_PURGE_LEGACY=1 pnpm run legacy:purge
```

That script (`scripts/legacy-purge.mjs`, wired as `pnpm run legacy:purge`):

1. Confirms `legacy/` exists (exits non-zero if already absent).
2. Refuses to run unless `MITII_PURGE_LEGACY=1` or an explicit `--yes` flag is passed.
3. Prints a short summary of what will be removed.
4. Executes `rm -rf legacy`.
5. Exits 0 on success.

## Do not

- Run this from CI without an explicit human release decision.
- Recreate `src/kernel` or a second legacy tree after purge.
- Expect agents to purge automatically — roadmap forbids silent purge.

## After purge

- Active product remains: `packages/`, `apps/`, `docs/`, `benchmark/` (until Phase 14), `.vscode/`.
- Re-run `pnpm run check:architecture` and package builds to confirm nothing still pointed at `legacy/`.
