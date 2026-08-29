import { AGENT_ENGINE_THRESHOLDS } from "../policy";
import type { AgentEngineThresholds } from "./resolveAgentEngineThresholds";

/**
 * File reads observed in the current model/tool loop (or since the last
 * successful mutation). Global unique-path counts cannot be used for stall
 * detection: verification repair re-reads known error files, so the unique
 * delta stays 0 and a productive repair looks like a spin.
 */
export interface LoopFileReadTracker {
  calls: number;
  paths: Set<string>;
}

export function createLoopFileReadTracker(): LoopFileReadTracker {
  return { calls: 0, paths: new Set() };
}

export function recordLoopFileReads(
  tracker: LoopFileReadTracker,
  paths: readonly string[],
): void {
  tracker.calls += 1;
  for (const path of paths) {
    const normalized = path.trim().replace(/\\/g, "/");
    if (normalized.length > 0) {
      tracker.paths.add(normalized);
    }
  }
}

export function resetLoopFileReadTracker(tracker: LoopFileReadTracker): void {
  tracker.calls = 0;
  tracker.paths.clear();
}

export function snapshotLoopFileReads(tracker: LoopFileReadTracker): {
  fileReadCalls: number;
  uniqueFilePathsTouched: number;
} {
  return {
    fileReadCalls: tracker.calls,
    uniqueFilePathsTouched: tracker.paths.size,
  };
}

export type ExplorationRereadThresholds = Pick<
  AgentEngineThresholds,
  "explorationRereadMinCalls" | "explorationRereadRatio"
>;

/**
 * True when file reads substantially exceed unique paths — the
 * re-read-in-circles pattern. Shared by post-run labeling and the
 * mid-loop stall breaker.
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
