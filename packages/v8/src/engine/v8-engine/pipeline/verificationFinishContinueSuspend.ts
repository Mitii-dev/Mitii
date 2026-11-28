/**
 * Suspend for Continue / stall wall after the model/tool loop.
 */
import type { RepoBuildState } from "../../../modules/verification";
import type { AgentRunResult } from "../contracts";
import {
  consultRuntimeGate,
  hubSuspendKind,
} from "../helpers/ConsultRuntimeGate";
import { saveSuspendedRun } from "../helpers/SaveSuspendedRun";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import type { VerificationSuspendCommon } from "./verificationFinishSuspendTypes";

export async function finishIfContinueRequired(
  runtime: AgentEngineRuntime,
  params: VerificationSuspendCommon & {
    currentOutcome: Extract<ToolLoopOutcome, { kind: "continue_required" }>;
    afterState?: RepoBuildState;
  },
): Promise<AgentRunResult> {
  const {
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
    repoBuildStateAfter,
    afterState,
    plan,
    executionSeed,
  } = params;

    if (!runtime.deps.checkpointStore) {
      await runtime.safeUnpin(runId, pinnedState);
      if (currentOutcome.wallReason === "budget_exhausted") {
        reasonCodes.push("budget_exhausted");
        return finish({
          status: "budget_exhausted",
          answer: currentOutcome.answer || undefined,
          reasonCodes,
          error: {
            code: "budget_exhausted",
            message: currentOutcome.rationale,
          },
        });
      }
      reasonCodes.push("misconfigured");
      return finish({
        status: "failed",
        reasonCodes,
        error: {
          code: "misconfigured",
          message: "Continue suspend requires a checkpoint store.",
        },
      });
    }

    // S10-EVAC: continue wall via gates hub (on_budget).
    const continueVerdict = consultRuntimeGate("on_budget", {
      runId,
      budgetHardWall: currentOutcome.wallReason === "budget_exhausted",
      stalledOrBlocked: currentOutcome.wallReason !== "budget_exhausted",
    });
    const continueKind = hubSuspendKind(
      continueVerdict,
      "continue_required",
    ) as NonNullable<AgentRunResult["suspension"]>["kind"];
    reasonCodes.push("stall_continue_suspended");
    warnings.push("gates_hub:continue_wall");
    await saveSuspendedRun({
      store: runtime.deps.checkpointStore,
      checkpoint: {
      runId,
      requestId,
      ...(runtime.contextEpochs.get(runId)
        ? { contextEpoch: runtime.contextEpochs.get(runId) }
        : {}),
      suspensionKind: continueKind,
      input,
      decision,
      pinnedState,
      messages: currentOutcome.messages,
      toolCacheEntries: currentOutcome.toolCache.entries(),
      changedFiles: currentOutcome.changedFiles,
      mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
      stallContinueRationale: currentOutcome.rationale,
      continuePartialAnswer: currentOutcome.answer || undefined,
      continueWallReason: currentOutcome.wallReason,
      continueOverrideCount: currentOutcome.continueOverrideCount,
      reasonCodes,
      warnings,
      usage: budget.snapshot(),
      startedAtMs,
      excludedWaitMs: budget.getExcludedWaitMs(),
      suspendedAtMs: Date.now(),
      repoBuildStateBefore,
      repoBuildStateAfter: afterState ?? repoBuildStateAfter,
      ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
      ...(taskListRef.completedPlanStepIds &&
      taskListRef.completedPlanStepIds.length > 0
        ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
        : {}),
      ...(plan ? { plan: plan } : {}),
      ...(executionSeed ? { executionSeed } : {}),
      },
    });

    runtime.emit(bus, {
      type: "suspended",
      runId,
      kind: "continue_required",
      rationale: currentOutcome.rationale,
      at: runtime.isoNow(),
    });

    return finish({
      status: "suspended",
      route: decision.route,
      planningDepth: decision.planningDepth,
      answer: currentOutcome.answer || undefined,
      suspension: {
        kind: "continue_required",
        rationale: currentOutcome.rationale,
        continuePrompt: currentOutcome.rationale,
      },
      reasonCodes,
    });
}
