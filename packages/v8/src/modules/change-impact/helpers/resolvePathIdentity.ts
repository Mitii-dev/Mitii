import type { ChangeImpactPathIdentityOverlay } from "../types";
import { normalizeRelativePath } from "./impactGraphHelpers";

export type PathIdentityResolution = {
  /** Paths to try when locating the seed file (preferred first). */
  candidatePaths: string[];
  /** Extra prior paths to dual-seed when those file nodes still exist. */
  retainedPriorPaths: string[];
  remapped: boolean;
};

/**
 * Resolve host path-identity overlays for a seed path.
 * Renames prefer the current path and retain the prior path when present.
 * Deletes keep the prior path as a retained seed when the node still exists.
 */
export function resolvePathIdentity(params: {
  relativePath: string;
  overlays?: readonly ChangeImpactPathIdentityOverlay[];
}): PathIdentityResolution {
  const seedPath = normalizeRelativePath(params.relativePath);
  const overlays = params.overlays ?? [];
  if (overlays.length === 0) {
    return {
      candidatePaths: [seedPath],
      retainedPriorPaths: [],
      remapped: false,
    };
  }

  const candidatePaths: string[] = [];
  const retainedPriorPaths: string[] = [];
  let remapped = false;

  const pushUnique = (target: string[], value: string) => {
    const normalized = normalizeRelativePath(value);
    if (!normalized || target.includes(normalized)) return;
    target.push(normalized);
  };

  pushUnique(candidatePaths, seedPath);

  for (const overlay of overlays) {
    const fromPath = normalizeRelativePath(overlay.fromRelativePath);
    const toPath = overlay.toRelativePath
      ? normalizeRelativePath(overlay.toRelativePath)
      : undefined;

    if (overlay.kind === "renamed" && toPath) {
      if (seedPath === toPath || seedPath === fromPath) {
        pushUnique(candidatePaths, toPath);
        pushUnique(candidatePaths, fromPath);
        pushUnique(retainedPriorPaths, fromPath);
        remapped = true;
      }
      continue;
    }

    if (overlay.kind === "deleted" && seedPath === fromPath) {
      pushUnique(candidatePaths, fromPath);
      pushUnique(retainedPriorPaths, fromPath);
      remapped = true;
    }
  }

  return {
    candidatePaths,
    retainedPriorPaths,
    remapped,
  };
}
