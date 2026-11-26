/**
 * Shim — owner is runtime/helpers/loop-rails/mutation-nudge.
 */
export {
  requiresMutation,
  batchIncludesMutatingTool,
  batchIsReadonlyTools,
  hasPlanDraftedThisRun,
  resolveReadonlyTurnsBeforeMutationNudge,
  shouldEscalateReadonlyThrashToContinue,
  softMutationNudgeMessage,
  readonlyThrashPartialAnswer,
  changeImpactRetryPatchMessage,
  unfulfilledExecuteNudgeMessage,
} from "../../../../runtime/helpers/loop-rails/mutation-nudge";
