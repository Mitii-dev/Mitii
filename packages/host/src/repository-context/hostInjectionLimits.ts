import { WORKSPACE_SKETCH_DEFAULTS } from './workspaceSketch.js';

/** Fallback maxima — prefer `injection` from Window Budget when provided. */
export const MAX_REPO_MAP_FILES = 400;
const MAX_REPO_MAP_CHARS = 24_000;

export type HostInjectionLimits = {
  repoMapChars: number;
  repoMapFilesMax: number;
  sketchChars: number;
  sketchItemsMax: number;
};

export function resolveHostInjectionLimits(injection?: {
  repoMapChars?: number;
  repoMapFilesMax?: number;
  sketchChars?: number;
  sketchItemsMax?: number;
}): HostInjectionLimits {
  const repoMapChars = Math.max(
    64,
    Math.floor(injection?.repoMapChars ?? MAX_REPO_MAP_CHARS),
  );
  return {
    repoMapChars,
    repoMapFilesMax: Math.max(
      1,
      Math.floor(injection?.repoMapFilesMax ?? MAX_REPO_MAP_FILES),
    ),
    sketchChars: Math.max(
      64,
      Math.floor(injection?.sketchChars ?? repoMapChars),
    ),
    sketchItemsMax: Math.max(
      1,
      Math.floor(
        injection?.sketchItemsMax ?? WORKSPACE_SKETCH_DEFAULTS.MAXIMUM_ITEMS,
      ),
    ),
  };
}
