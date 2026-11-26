/**
 * Shim — owner is runtime/helpers/loop-rails/loop-file-reads.
 */
export {
  createLoopFileReadTracker,
  recordLoopFileReads,
  markLoopFileReadResult,
  resetLoopFileReadTracker,
  snapshotLoopFileReads,
  isExplorationRereadHeavy,
  isLoopFilePathFullyLoaded,
  DEFAULT_SAME_PATH_READ_ALLOWANCE,
} from "../../../runtime/helpers/loop-rails/loop-file-reads/LoopFileReads";
export type {
  LoopFileReadCoverage,
  LoopFileReadTracker,
  ExplorationRereadThresholds,
} from "../../../runtime/helpers/loop-rails/loop-file-reads/LoopFileReads";
