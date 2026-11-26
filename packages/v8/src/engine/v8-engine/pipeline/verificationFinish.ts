import { resolveLoopPolicyThresholds } from "../actions";
import type { AgentEngineRuntime } from "./runtime";
import type { AgentRunResult } from "../contracts";

import { finishIfNonCompletedOutcome } from "./verificationFinishEarlyOutcomes";
import { runCompletedVerificationPass } from "./verificationFinishCompletedPass";
import { handleVerificationFailed } from "./verificationFinishFailed";
import { finishVerificationAccepted } from "./finishVerificationAccepted";
import type {
  FinishAfterLoopParams,
  FinishLoopMutable,
} from "./verificationFinishTypes";

export type {
  FinishAfterLoopParams,
  FinishAfterLoopFinish,
  FinishAfterLoopContext,
} from "./verificationFinishTypes";

export async function finishAfterLoop(
  runtime: AgentEngineRuntime,
  params: FinishAfterLoopParams,
): Promise<AgentRunResult> {
  const { loopOutcome, windowPolicy, input } = params;
  const continueOverrideCount = params.continueOverrideCount ?? 0;
  const thresholds = resolveLoopPolicyThresholds({
    contextWindowTokens: windowPolicy.contextWindowTokens,
    overrides: input.loopPolicy?.thresholds,
  }).thresholds;

  const state: FinishLoopMutable = {
    currentOutcome: loopOutcome,
    // Authority may have been refreshed mid-loop (e.g. after approval or
    // escalation); prefer whatever the loop last resolved over the pre-loop
    // decision so verification and any repair rerun use live authority.
    decision:
      loopOutcome.kind === "completed" ||
      loopOutcome.kind === "approval_required" ||
      loopOutcome.kind === "grant_expansion_required" ||
      loopOutcome.kind === "continue_required"
        ? loopOutcome.decision
        : params.decision,
    afterState: params.repoBuildStateAfter,
    repairAttempts: 0,
    previousAfterErrorCount: undefined,
    consecutiveStalledRepairs: 0,
  };

  while (true) {
    const early = await finishIfNonCompletedOutcome(runtime, params, state);
    if (early) {
      return early;
    }

    const pass = await runCompletedVerificationPass(runtime, params, state);

    if (pass.verificationOutcome.kind === "ok") {
      // ACCEPTED = hard terminal. Never Continue/repair/rediscover.
      return finishVerificationAccepted({
        runtime,
        runId: params.runId,
        pinnedState: params.pinnedState,
        reasonCodes: params.reasonCodes,
        repairAttempts: state.repairAttempts,
        loopAnswer: pass.loopAnswer,
        loopChangedFiles: pass.loopChangedFiles,
        record: pass.record,
        remainingErrorCount:
          pass.verificationOutcome.comparison?.remainingErrorCount ?? 0,
        newErrorCount: pass.verificationOutcome.comparison?.newErrorCount ?? 0,
        decision: state.decision,
        understanding: params.loopContext?.understanding,
        taskList: params.taskListRef.current,
        nextPlanPhaseOffer: params.loopContext?.nextPlanPhaseOffer,
        finish: params.finish,
      });
    }

    const handled = await handleVerificationFailed({
      runtime,
      runId: params.runId,
      requestId: params.requestId,
      input: params.input,
      request: params.request,
      bus: params.bus,
      signal: params.signal,
      pinnedState: params.pinnedState,
      reasonCodes: params.reasonCodes,
      warnings: params.warnings,
      budget: params.budget,
      startedAtMs: params.startedAtMs,
      finish: params.finish,
      cancelledResult: params.cancelledResult,
      taskListRef: params.taskListRef,
      repoBuildStateBefore: params.repoBuildStateBefore,
      evidence: params.evidence,
      windowPolicy: params.windowPolicy,
      loopContext: params.loopContext,
      verificationOutcome: pass.verificationOutcome,
      record: pass.record,
      recordStatus: pass.recordStatus,
      loopChangedFiles: pass.loopChangedFiles,
      loopMutationIds: pass.loopMutationIds,
      loopAnswer: pass.loopAnswer,
      thresholds,
      continueOverrideCount,
      dirtyPaths: params.dirtyPaths,
      onVerificationRecord: params.onVerificationRecord,
      state: {
        currentOutcome: state.currentOutcome,
        decision: state.decision,
        afterState: state.afterState,
        repairAttempts: state.repairAttempts,
        previousAfterErrorCount: state.previousAfterErrorCount,
        consecutiveStalledRepairs: state.consecutiveStalledRepairs,
      },
    });
    if (handled.kind === "return") {
      return handled.result;
    }
    state.currentOutcome = handled.state.currentOutcome;
    state.decision = handled.state.decision;
    state.afterState = handled.state.afterState;
    state.repairAttempts = handled.state.repairAttempts;
    state.previousAfterErrorCount = handled.state.previousAfterErrorCount;
    state.consecutiveStalledRepairs = handled.state.consecutiveStalledRepairs;
  }
}
