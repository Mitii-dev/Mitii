/**
 * Copy pre-settle rail state back onto the model-loop session.
 */
import type { ModelLoopSession } from "./modelLoopInit";
import type { PreSettleRailsState } from "./handlePreSettleTurnRailsTypes";

export function applyPreSettleStateToSession(params: {
  session: ModelLoopSession;
  state: PreSettleRailsState;
}): boolean {
  const { session, state } = params;
  session.forceFinalOnly = state.forceFinalOnly;
  session.truncationRecoveriesUsed = state.truncationRecoveriesUsed;
  session.reasoningAbortRecoveriesUsed = state.reasoningAbortRecoveriesUsed;
  session.readOnlyTurnsWithoutMutation = state.readOnlyTurnsWithoutMutation;
  session.readonlyTurnsOnActiveStep = state.readonlyTurnsOnActiveStep;
  session.lastActiveStepId = state.lastActiveStepId;
  session.evidenceGateNudges = state.evidenceGateNudges;
  session.evidenceRecoveryUsed = state.evidenceRecoveryUsed;
  session.awaitingMutateOnly = state.awaitingMutateOnly;
  session.mutateLockAllowTargetedReads = state.mutateLockAllowTargetedReads;
  session.softMutationNudges = state.softMutationNudges;
  return state.softNudgeAfterSettle;
}

export function snapshotPreSettleState(
  session: ModelLoopSession,
): Omit<PreSettleRailsState, "softNudgeAfterSettle"> {
  return {
    forceFinalOnly: session.forceFinalOnly,
    truncationRecoveriesUsed: session.truncationRecoveriesUsed,
    reasoningAbortRecoveriesUsed: session.reasoningAbortRecoveriesUsed,
    readOnlyTurnsWithoutMutation: session.readOnlyTurnsWithoutMutation,
    readonlyTurnsOnActiveStep: session.readonlyTurnsOnActiveStep,
    lastActiveStepId: session.lastActiveStepId,
    evidenceGateNudges: session.evidenceGateNudges,
    evidenceRecoveryUsed: session.evidenceRecoveryUsed,
    awaitingMutateOnly: session.awaitingMutateOnly,
    mutateLockAllowTargetedReads: session.mutateLockAllowTargetedReads,
    softMutationNudges: session.softMutationNudges,
  };
}
