/**
 * Finish-after-loop handlers for non-completed outcomes (suspend / cancel / budget / fail).
 */
import { selectUserFacingLoopAnswer } from "../actions";
import type { AgentRunResult } from "../contracts";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import {
  commitMutations,
  persistVerificationArtifact,
  runVerificationGate,
} from "./verificationSupport";
import { finishIfApprovalRequired } from "./verificationFinishApproval";
import {
  finishIfGrantExpansionRequired,
  finishIfContinueRequired,
} from "./verificationFinishSuspend";
import type {
  FinishAfterLoopParams,
  FinishLoopMutable,
} from "./verificationFinishTypes";

export async function finishIfNonCompletedOutcome(
  runtime: AgentEngineRuntime,
  params: FinishAfterLoopParams,
  state: FinishLoopMutable,
): Promise<AgentRunResult | undefined> {
  const {
    runId,
    requestId,
    input,
    bus,
    pinnedState,
    reasonCodes,
    warnings,
    budget,
    startedAtMs,
    finish,
    cancelledResult,
    taskListRef,
    repoBuildStateBefore,
    evidence,
    windowPolicy,
  } = params;
  const { currentOutcome, decision } = state;

  if (currentOutcome.kind === "approval_required") {
    return finishIfApprovalRequired(runtime, {
      runId,
      requestId,
      input,
      decision,
      bus,
      pinnedState,
      currentOutcome,
      reasonCodes,
      warnings,
      budget,
      startedAtMs,
      finish,
      taskListRef,
      repoBuildStateBefore,
      repoBuildStateAfter: params.repoBuildStateAfter,
    });
  }

  if (currentOutcome.kind === "grant_expansion_required") {
    return finishIfGrantExpansionRequired(runtime, {
      runId,
      requestId,
      input,
      decision,
      bus,
      pinnedState,
      currentOutcome,
      reasonCodes,
      warnings,
      budget,
      startedAtMs,
      finish,
      taskListRef,
      repoBuildStateBefore,
      repoBuildStateAfter: params.repoBuildStateAfter,
      plan: params.loopContext?.plan,
    });
  }

  if (currentOutcome.kind === "continue_required") {
    return finishIfContinueRequired(runtime, {
      runId,
      requestId,
      input,
      decision,
      bus,
      pinnedState,
      currentOutcome,
      reasonCodes,
      warnings,
      budget,
      startedAtMs,
      finish,
      taskListRef,
      repoBuildStateBefore,
      repoBuildStateAfter: params.repoBuildStateAfter,
      afterState: state.afterState,
      plan: params.loopContext?.plan,
      executionSeed: params.loopContext?.executionSeed,
    });
  }

  if (currentOutcome.kind === "cancelled") {
    await runtime.safeUnpin(runId, pinnedState);
    return cancelledResult();
  }

  if (currentOutcome.kind === "budget_exhausted") {
    if (currentOutcome.changedFiles.length > 0) {
      const verificationOutcome = await runVerificationGate(runtime, {
        runId,
        bus,
        decision,
        primaryTaskIntent:
          params.loopContext?.understanding?.intent.classification
            .primaryTaskIntent,
        input,
        pinnedState,
        changedFiles: currentOutcome.changedFiles,
        mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
        reasonCodes,
        warnings,
        repoBuildStateBefore,
        onRepoBuildStateAfter: (next) => {
          state.afterState = next;
          params.onRepoBuildStateAfter?.(next);
        },
        evidence,
        windowPolicy,
        signal: params.signal,
        askScopePaths: [
          ...(params.loopContext?.executionSeed?.paths ?? []),
          ...(params.loopContext?.memoryFileTargets ?? []),
        ],
      });
      commitMutations(runtime, currentOutcome.mutationCheckpointIds, {
        runId,
        bus,
        warnings,
        logVerbosity: input.logVerbosity,
      });
      const record = await persistVerificationArtifact(runtime, {
        runId,
        requestId,
        workspaceId: resolveWorkspaceId(input),
        bus,
        reasonCodes,
        warnings,
        status:
          verificationOutcome.kind === "ok" &&
          verificationOutcome.acceptKind === "verified_success"
            ? "passed"
            : "incomplete",
        before: repoBuildStateBefore,
        after: state.afterState,
        comparison: verificationOutcome.comparison,
        verification: verificationOutcome.verification,
        changedFiles: currentOutcome.changedFiles,
        logVerbosity: input.logVerbosity,
      });
      if (record) {
        params.onVerificationRecord?.(record);
      }
    }
    await runtime.safeUnpin(runId, pinnedState);
    reasonCodes.push("budget_exhausted");
    return finish({
      status: "budget_exhausted",
      answer: selectUserFacingLoopAnswer({
        loopAnswer: currentOutcome.answer,
        changedFiles: currentOutcome.changedFiles,
      }),
      reasonCodes,
      error: {
        code: "budget_exhausted",
        message: currentOutcome.message,
      },
    });
  }

  if (currentOutcome.kind === "failed") {
    await runtime.safeUnpin(runId, pinnedState);
    return finish({
      status: "failed",
      answer: currentOutcome.answer,
      reasonCodes: [...reasonCodes, ...currentOutcome.extraReasons],
      error: currentOutcome.error,
    });
  }

  if (currentOutcome.kind !== "completed") {
    await runtime.safeUnpin(runId, pinnedState);
    return finish({
      status: "failed",
      reasonCodes: [...reasonCodes, "misconfigured"],
      error: {
        code: "misconfigured",
        message: "Verification gate expected a completed model/tool loop.",
      },
    });
  }

  return undefined;
}
