/**
 * After-decide clarification suspend (gates hub + checkpoint).
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import { EXECUTION_ROUTE } from "../../../modules/decision-policy";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";

import { buildClarificationPayload } from "../actions";
import type { AgentReasonCode, AgentRunResult } from "../contracts";
import type { AgentEngineStartInput } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import {
  consultRuntimeGate,
  hubSuspendKind,
} from "../helpers/ConsultRuntimeGate";
import { saveSuspendedRun } from "../helpers/SaveSuspendedRun";
import type { AgentEngineRuntime } from "./runtime";
import type {
  ExecuteStartSharedState,
  StartEarlyFinish,
  StartEarlyPipelineOutcome,
} from "./executeStartEarlyPipelineTypes";

export async function maybeSuspendForClarification(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  startedMs: number;
  shared: ExecuteStartSharedState;
  taskListRef: TaskListRef;
  finish: StartEarlyFinish;
  decision: ExecutionDecision;
  understanding: RequestUnderstandingResult;
  steeringBallotV2: boolean;
}): Promise<StartEarlyPipelineOutcome | undefined> {
  const {
    runtime,
    runId,
    input,
    bus,
    budget,
    reasonCodes,
    warnings,
    startedMs,
    shared,
    taskListRef,
    finish,
    decision,
    understanding,
    steeringBallotV2,
  } = params;

  // S10-EVAC: early clarify via gates hub (after_decide).
  const clarifyVerdict = consultRuntimeGate("after_decide", {
    runId,
    route: decision.route,
    runDisposition: decision.runDisposition,
  });
  if (
    !(
      clarifyVerdict?.action === "suspend" ||
      decision.runDisposition === "clarification_required" ||
      decision.route === EXECUTION_ROUTE.CLARIFY
    )
  ) {
    return undefined;
  }

  reasonCodes.push("clarification_suspended");
  warnings.push("gates_hub:after_decide");
  const suspendKind = hubSuspendKind(
    clarifyVerdict,
    "clarification_required",
  ) as NonNullable<AgentRunResult["suspension"]>["kind"];
  const rationale =
    decision.rationale ||
    "Material clarification is required before continuing.";
  const clarification = buildClarificationPayload(understanding, rationale, {
    ballotV2: steeringBallotV2,
  });
  if (runtime.deps.checkpointStore) {
    await saveSuspendedRun({
      store: runtime.deps.checkpointStore,
      checkpoint: {
        runId,
        requestId: shared.requestId,
        suspensionKind: suspendKind,
        input,
        decision,
        pinnedState: undefined,
        messages: [],
        toolCacheEntries: [],
        pendingApproval: undefined,
        changedFiles: [],
        mutationCheckpointIds: [],
        reasonCodes,
        warnings,
        usage: budget.snapshot(),
        startedAtMs: startedMs,
        repoBuildStateBefore: shared.repoBuildStateBefore,
        repoBuildStateAfter: shared.repoBuildStateAfter,
        ...(clarification.clarificationSession
          ? { clarificationSession: clarification.clarificationSession }
          : {}),
        ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
        ...(taskListRef.completedPlanStepIds &&
        taskListRef.completedPlanStepIds.length > 0
          ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
          : {}),
      },
    });
  }
  runtime.emit(bus, {
    type: "suspended",
    runId,
    kind: suspendKind,
    rationale,
    at: runtime.isoNow(),
  });
  // Clarification doesn't need repository context; release the pin
  // taken above rather than leak it (checkpoint intentionally omits
  // pinnedState — a clarification resume re-pins on its own path).
  await runtime.safeUnpin(runId, shared.pinnedState);
  return {
    kind: "terminal",
    result: finish({
      status: "suspended",
      route: decision.route,
      planningDepth: decision.planningDepth,
      suspension: {
        kind: suspendKind,
        rationale,
        clarificationPrompt: clarification.clarificationPrompt,
        clarificationOptions:
          clarification.clarificationOptions.length > 0
            ? clarification.clarificationOptions
            : undefined,
      },
      reasonCodes,
    }),
  };
}
