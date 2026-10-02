import { PathContainmentError } from "../internal/PathContainment";

/**
 * Segment names that must never be written, deleted, or moved via mutation tools.
 * Defense against verification-repair thrash (e.g. patching node_modules/vitest).
 */
const HARD_DENIED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
]);

/**
 * Reject mutation paths under vendored / VCS / common build-output trees.
 * Fail closed before FS. Orthogonal to grant pathScopes and protectedPathGlobs
 * (those force approval; this hard-denies).
 */
export function assertHardDeniedMutationPath(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    return;
  }
  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments) {
    if (HARD_DENIED_SEGMENTS.has(segment)) {
      throw new PathContainmentError(
        "path_hard_denied",
        `Path "${normalized}" is hard-denied for mutation (vendored, VCS, or build output). Edit project sources instead.`,
      );
    }
  }
}

/** Exported for tests and demotion rules. */
export function isHardDeniedMutationPath(relativePath: string): boolean {
  try {
    assertHardDeniedMutationPath(relativePath);
    return false;
  } catch {
    return true;
  }
}
