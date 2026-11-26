/**
 * Shim — owner is runtime/helpers/loop-turn.
 */
export {
  LOOP_TURN_DISPOSITIONS,
  resolveLoopTurnOutcome,
  WORKSPACE_FILE_MUTATION_TOOL_IDS,
  grantAllowsWorkspaceFileMutation,
  isUnfulfilledExecute,
  isSyntheticCompletedEditsFallback,
  isPrematurePartialExecuteStop,
  claimsMissingWorkspaceContext,
  requiresMutationForExecute,
  buildUnfulfilledExecuteRecoveryMessage,
} from "../../../runtime/helpers/loop-turn";
export type {
  LoopTurnDisposition,
  ResolveLoopTurnOutcomeInput,
  ResolveLoopTurnOutcome,
} from "../../../runtime/helpers/loop-turn";
