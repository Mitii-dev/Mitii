/**
 * Shim — owner is runtime/helpers/compaction.
 */
export {
  compactModelLoopMessages,
  compactModelLoopMessagesFromWindowPolicy,
  resolveCompactionPressure,
  resolveCompactionThresholds,
  estimateModelMessageTokens,
  estimateModelMessagesTokens,
  COMPACTION_LADDER_STAGES,
  stubToolResultsForCompletedPaths,
} from "../../../runtime/helpers/compaction";
export type {
  ModelLoopCompactionPressure,
  ModelLoopCompactionThresholds,
  CompactionLadderStage,
  ModelLoopCompactionResult,
} from "../../../runtime/helpers/compaction";
