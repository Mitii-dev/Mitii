/**
 * Workspace index size policy.
 *
 * Default is the primary 30k-file target. Hosts may raise the cap up to
 * 240k for very large repos. Ignore rules still exclude build output and secrets.
 */
export const DEFAULT_MAXIMUM_INDEX_FILES = 30_000;
export const MAXIMUM_INDEX_FILES = 240_000;
export const DEFAULT_INDEX_SCAN_TIMEOUT_MS = 120_000;
export const MAXIMUM_INDEX_SCAN_TIMEOUT_MS = 600_000;

export function resolveMaximumIndexFiles(requested?: number): number {
  if (
    requested === undefined ||
    !Number.isFinite(requested) ||
    requested <= 0
  ) {
    return DEFAULT_MAXIMUM_INDEX_FILES;
  }

  return Math.min(
    MAXIMUM_INDEX_FILES,
    Math.max(1, Math.floor(requested)),
  );
}

export function resolveIndexScanTimeoutMs(maximumFiles: number): number {
  const batches = Math.max(
    1,
    Math.ceil(maximumFiles / DEFAULT_MAXIMUM_INDEX_FILES),
  );
  return Math.min(
    MAXIMUM_INDEX_SCAN_TIMEOUT_MS,
    DEFAULT_INDEX_SCAN_TIMEOUT_MS * batches,
  );
}
