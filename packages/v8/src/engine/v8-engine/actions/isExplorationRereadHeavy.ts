import { AGENT_ENGINE_THRESHOLDS } from "../legacy/policy";
import { stripPathRangeSuffix } from "../modules/tool-content-paths";
import type { AgentEngineThresholds } from "./resolveAgentEngineThresholds";

/**
 * File reads observed in the current model/tool loop (or since the last
 * successful mutation). Global unique-path counts cannot be used for stall
 * detection: verification repair re-reads known error files, so the unique
 * delta stays 0 and a productive repair looks like a spin.
 *
 * Coverage is per base path (range suffix stripped). Windowed reads of the
 * same large file count as one evidence unit for thrash until they exceed
 * `explorationSamePathReadAllowance`. A path is only "fully loaded" after a
 * successful non-truncated eof read.
 */
export interface LoopFileReadCoverage {
  /** Base repo path (range suffix stripped). */
  path: string;
  /** True only after a successful read with eof && !truncated. */
  fullyLoaded: boolean;
  /** Successful read attempts for this base path in this loop. */
  readCount: number;
}

export interface LoopFileReadTracker {
  /** Raw successful/attempted read_file batches (telemetry). */
  calls: number;
  /**
   * Historical set of recorded path keys (may include range suffixes).
   * Prefer `byPath` for readiness/thrash; kept for backward-compatible iteration.
   */
  paths: Set<string>;
  /** Base-path coverage used by thrash + mutate readiness. */
  byPath: Map<string, LoopFileReadCoverage>;
}

/** Default windowed reads of one file before thrash charges extras. */
export const DEFAULT_SAME_PATH_READ_ALLOWANCE = 4;

export function createLoopFileReadTracker(): LoopFileReadTracker {
  return { calls: 0, paths: new Set(), byPath: new Map() };
}

export function recordLoopFileReads(
  tracker: LoopFileReadTracker,
  paths: readonly string[],
  meta?: { fullyLoaded?: boolean },
): void {
  tracker.calls += 1;
  const assumeLoaded = meta?.fullyLoaded === true;
  for (const path of paths) {
    const base = normalizeBasePath(path);
    if (!base) continue;
    tracker.paths.add(path.trim().replace(/\\/g, "/") || base);
    const existing = tracker.byPath.get(base);
    if (existing) {
      existing.readCount += 1;
      if (assumeLoaded) {
        existing.fullyLoaded = true;
      }
    } else {
      tracker.byPath.set(base, {
        path: base,
        fullyLoaded: assumeLoaded,
        readCount: 1,
      });
    }
  }
}

/**
 * Update coverage after a successful read_file / read_many_files result.
 * Truncated or non-eof windows keep the path not fully loaded.
 */
export function markLoopFileReadResult(
  tracker: LoopFileReadTracker,
  path: string,
  result: { truncated: boolean; eof?: boolean },
): void {
  const base = normalizeBasePath(path);
  if (!base) return;
  const fullyLoaded = result.truncated !== true && result.eof === true;
  const existing = tracker.byPath.get(base);
  if (existing) {
    if (fullyLoaded) {
      existing.fullyLoaded = true;
    }
    return;
  }
  tracker.byPath.set(base, {
    path: base,
    fullyLoaded,
    readCount: 1,
  });
  tracker.paths.add(base);
}

export function resetLoopFileReadTracker(tracker: LoopFileReadTracker): void {
  tracker.calls = 0;
  tracker.paths.clear();
  tracker.byPath.clear();
}

export function snapshotLoopFileReads(
  tracker: LoopFileReadTracker,
  thresholds: Pick<
    ExplorationRereadThresholds,
    "explorationSamePathReadAllowance"
  > = AGENT_ENGINE_THRESHOLDS,
): {
  fileReadCalls: number;
  uniqueFilePathsTouched: number;
  rawFileReadCalls: number;
} {
  const allowance =
    thresholds.explorationSamePathReadAllowance ??
    DEFAULT_SAME_PATH_READ_ALLOWANCE;
  return {
    rawFileReadCalls: tracker.calls,
    uniqueFilePathsTouched: tracker.byPath.size,
    fileReadCalls: effectiveFileReadCalls(tracker, allowance),
  };
}

export type ExplorationRereadThresholds = Pick<
  AgentEngineThresholds,
  "explorationRereadMinCalls" | "explorationRereadRatio"
> & {
  /** Defaults to DEFAULT_SAME_PATH_READ_ALLOWANCE when omitted. */
  explorationSamePathReadAllowance?: number;
};

/**
 * True when file reads substantially exceed unique paths — the
 * re-read-in-circles pattern. Same-file windowed reads within the allowance
 * count as one unit so large-file paging is not thrash.
 */
export function isExplorationRereadHeavy(
  snapshot: {
    fileReadCalls: number;
    uniqueFilePathsTouched: number;
  },
  thresholds: ExplorationRereadThresholds = AGENT_ENGINE_THRESHOLDS,
): boolean {
  if (
    snapshot.fileReadCalls < thresholds.explorationRereadMinCalls ||
    snapshot.uniqueFilePathsTouched <= 0
  ) {
    return false;
  }
  return (
    snapshot.fileReadCalls >=
    snapshot.uniqueFilePathsTouched * thresholds.explorationRereadRatio
  );
}

/** Whether mutate readiness may treat this path as loaded evidence. */
export function isLoopFilePathFullyLoaded(
  tracker: LoopFileReadTracker | undefined,
  path: string,
): boolean {
  if (!tracker) return false;
  const base = normalizeBasePath(path);
  if (!base) return false;
  return tracker.byPath.get(base)?.fullyLoaded === true;
}

function effectiveFileReadCalls(
  tracker: LoopFileReadTracker,
  allowance: number,
): number {
  if (tracker.byPath.size === 0) {
    return tracker.calls;
  }
  let effective = 0;
  for (const coverage of tracker.byPath.values()) {
    // First read of a path counts as 1; extras beyond allowance also count.
    effective += 1 + Math.max(0, coverage.readCount - Math.max(1, allowance));
  }
  return effective;
}

function normalizeBasePath(value: string): string {
  return stripPathRangeSuffix(
    value
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, ""),
  );
}
