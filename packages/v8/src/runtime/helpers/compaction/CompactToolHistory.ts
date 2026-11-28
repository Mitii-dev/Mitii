/** Barrel for tool-history compaction helpers. */
export {
  COMPACTED_PATCH_PLACEHOLDER,
  buildCompactedToolArguments,
  buildSchemaSafeCompactedToolArguments,
  compactApplyPatchArguments,
  compactReadManyFilesArguments,
  compactObject,
  parseJsonObject,
  countNonSystemMessages,
  takeLastIndices,
  dropOldestNonSystemTurnWithRemoved,
  collectToolCallsById,
} from "./CompactToolArguments";
export {
  compactToolMessageContent,
  buildDroppedTurnsSummary,
  summarizeToolCalls,
  summarizeDroppedToolTurn,
} from "./CompactToolHistoryTurns";
