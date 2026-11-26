/** Soft loop rails (§10) — non-suspending pump nudges. Not gates. */

export {
  ToolLoopGuard,
  softToolLoopNudgeMessage,
  forceFinalToolLoopMessage,
} from "./tool-loop-guard/ToolLoopGuard";
export type {
  ToolLoopCall,
  ToolLoopResult,
  ToolLoopCallDecision,
  ToolLoopResultDecision,
  ToolLoopGuardOptions,
} from "./tool-loop-guard/ToolLoopGuard";

export {
  decideTruncationRecovery,
  truncationWarningMessage,
} from "./truncation/DecideTruncationRecovery";
export type {
  TruncationRecoveryKind,
  TruncationRecoveryDecision,
} from "./truncation/DecideTruncationRecovery";

export {
  createLoopFileReadTracker,
  recordLoopFileReads,
  markLoopFileReadResult,
  resetLoopFileReadTracker,
  snapshotLoopFileReads,
  isExplorationRereadHeavy,
  isLoopFilePathFullyLoaded,
  DEFAULT_SAME_PATH_READ_ALLOWANCE,
} from "./loop-file-reads/LoopFileReads";
export type {
  LoopFileReadCoverage,
  LoopFileReadTracker,
  ExplorationRereadThresholds,
} from "./loop-file-reads/LoopFileReads";

export * from "./mutate-readiness";
export * from "./mutation-critic";
export * from "./mutation-nudge";
