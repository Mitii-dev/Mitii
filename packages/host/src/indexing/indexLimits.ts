/**
 * Workspace index size and throughput policy.
 *
 * Default is the primary 30k-file target. Hosts may raise the cap up to
 * 240k for very large repos. Ignore rules still exclude build output and secrets.
 */
import { cpus } from 'node:os';

export const DEFAULT_MAXIMUM_INDEX_FILES = 30_000;
export const MAXIMUM_INDEX_FILES = 240_000;
export const DEFAULT_INDEX_SCAN_TIMEOUT_MS = 120_000;
export const MAXIMUM_INDEX_SCAN_TIMEOUT_MS = 600_000;

/** Default file-processing concurrency (fast on modern CPUs, safe on laptops). */
export const DEFAULT_INDEX_CONCURRENCY = 6;
export const MINIMUM_INDEX_CONCURRENCY = 1;
export const MAXIMUM_INDEX_CONCURRENCY = 32;
/** Soft band recommended for interactive Desktop / VS Code hosts. */
export const RECOMMENDED_INDEX_CONCURRENCY_MIN = 4;
export const RECOMMENDED_INDEX_CONCURRENCY_MAX = 8;

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

/**
 * Resolve indexing file concurrency.
 *
 * Priority: explicit request → `MITII_INDEX_CONCURRENCY` → CPU heuristic (4–8).
 */
export function resolveIndexConcurrency(requested?: number): number {
  const fromRequest = sanitizeConcurrency(requested);
  if (fromRequest !== undefined) return fromRequest;

  const fromEnv = sanitizeConcurrency(
    Number(process.env.MITII_INDEX_CONCURRENCY),
  );
  if (fromEnv !== undefined) return fromEnv;

  const cpuCount = Math.max(1, cpus().length || 4);

  // Leave headroom for UI / embedding; clamp to the recommended interactive band.
  return Math.max(
    RECOMMENDED_INDEX_CONCURRENCY_MIN,
    Math.min(
      RECOMMENDED_INDEX_CONCURRENCY_MAX,
      Math.floor(cpuCount / 2) || 4,
    ),
  );
}

function sanitizeConcurrency(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(
    MAXIMUM_INDEX_CONCURRENCY,
    Math.max(MINIMUM_INDEX_CONCURRENCY, Math.floor(value)),
  );
}
