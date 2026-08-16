import { AGENT_ENGINE_THRESHOLDS } from "../policy";

/**
 * True when file reads substantially exceed unique paths — the
 * re-read-in-circles pattern. Shared by post-run labeling and the
 * mid-loop stall breaker.
 */
export function isExplorationRereadHeavy(snapshot: {
  fileReadCalls: number;
  uniqueFilePathsTouched: number;
}): boolean {
  if (
    snapshot.fileReadCalls < AGENT_ENGINE_THRESHOLDS.explorationRereadMinCalls ||
    snapshot.uniqueFilePathsTouched <= 0
  ) {
    return false;
  }
  return (
    snapshot.fileReadCalls >=
    snapshot.uniqueFilePathsTouched *
      AGENT_ENGINE_THRESHOLDS.explorationRereadRatio
  );
}
