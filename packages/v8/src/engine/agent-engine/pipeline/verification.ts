/**
 * Shared tail for start() and resume(): interpret the model/tool loop
 * outcome, suspend for approval, gate on verification, and unpin state.
 */

export { finishAfterLoop } from "./verificationFinish";
export {
  isVerificationRetryAsk,
  captureBuildStateFromVerificationResult,
  applyRepoBuildStateComparisonReasonCodes,
  runVerificationGate,
  applyVerificationAcceptSideEffects,
  commitMutations,
  emitVerificationCompleted,
  persistVerificationArtifact,
  summarizeVerificationForUser,
  tryNarrateVerificationSummary,
  commitVerificationMemory,
  tryLoadVerificationRetry,
} from "./verificationSupport";
