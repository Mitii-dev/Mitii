// Fixtures are installed with `npm install --ignore-scripts` (no arbitrary
// postinstall scripts). A small allowlist of trusted native deps still need
// their addon built — mirrors the root pnpm-workspace.yaml
// `onlyBuiltDependencies` allowlist rather than re-enabling all scripts.
export const NATIVE_REBUILD_DEPS = Object.freeze(['better-sqlite3']);

export function needsNativeRebuild(packageManifest) {
  const deps = {
    ...(packageManifest.dependencies ?? {}),
    ...(packageManifest.devDependencies ?? {}),
  };
  return NATIVE_REBUILD_DEPS.filter((name) => name in deps);
}
