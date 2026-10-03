import {
  canonicalizeMutationPath,
} from "../internal/canonicalizeMutationPath";
import { PathContainmentError } from "../internal/PathContainment";

/**
 * Segment names that must never be written, deleted, or moved via mutation tools.
 * Aligned with Verification denied trees (vendored / VCS / build / caches).
 * Defense against verification-repair thrash (e.g. patching node_modules/vitest).
 */
const HARD_DENIED_SEGMENTS = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  "site-packages",
  ".gradle",
  ".mvn",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  "pods",
]);

/**
 * Reject mutation paths under vendored / VCS / common build-output trees.
 * Canonicalizes first so `@node_modules/…` and `github/…` cannot bypass.
 * Fail closed before FS. Orthogonal to grant pathScopes and protectedPathGlobs.
 */
export function assertHardDeniedMutationPath(relativePath: string): void {
  let normalized: string;
  try {
    normalized = canonicalizeMutationPath(relativePath);
  } catch (error) {
    if (error instanceof PathContainmentError) {
      throw error;
    }
    normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  }
  if (!normalized || normalized === ".") {
    return;
  }
  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments) {
    if (HARD_DENIED_SEGMENTS.has(segment.toLowerCase())) {
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
  } catch (error) {
    if (
      error instanceof PathContainmentError &&
      error.reasonCode === "path_hard_denied"
    ) {
      return true;
    }
    // path_escape etc. are not "hard denied" for demotion helpers.
    if (error instanceof PathContainmentError) {
      return false;
    }
    return true;
  }
}
