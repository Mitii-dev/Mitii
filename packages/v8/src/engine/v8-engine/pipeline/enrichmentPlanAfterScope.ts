/**
 * Post-scope plan approval suspend + Plan-mode terminal.
 */
import {
  formatPlanAsAnswer,
  type PlanArtifact,
  type PlanClarifyDraft,
  type PlanStrategyDecision,
} from "../../../modules/planning";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { formatPlanAnswerWithNextPhase } from "../modules/plan-discovery";
import {
  consultRuntimeGate,
  hubSuspendKind,
} from "../helpers/ConsultRuntimeGate";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import { saveSuspendedRun } from "../helpers/SaveSuspendedRun";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";

type PostPlanFinish = (partial: {
  status: AgentRunStatus;
  route?: AgentRunResult["route"];
  planningDepth?: AgentRunResult["planningDepth"];
  answer?: string;
  plan?: AgentRunResult["plan"];
  suspension?: AgentRunResult["suspension"];
  reasonCodes?: AgentReasonCode[];
}) => AgentRunResult;

export async function maybeSuspendAfterPlanScope(params: {
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
  envelope: UserRequestEnvelope;
  decision: ExecutionDecision;
  plan: PlanArtifact;
  planStrategy: PlanStrategyDecision | undefined;
  clarifyDraft: PlanClarifyDraft | undefined;
  skipPlanGate: boolean;
  finish: PostPlanFinish;
}): Promise<StartEnrichmentOutcome | undefined> {
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
    envelope,
    decision,
    plan,
    planStrategy,
    clarifyDraft,
    skipPlanGate,
    finish,
  } = params;

  if (!skipPlanGate && decision.planGate === "required_before_execute") {
    // S10-EVAC: stamp hub kind; entry condition stays planGate (legacy-compatible).
    const planApprovalVerdict = consultRuntimeGate("after_plan", {
      runId,
      mode: "agent",
      route: "execute",
      planningDepth: "visible",
      planGate: "required_before_execute",
    });
    reasonCodes.push("plan_approval_suspended");
    warnings.push("gates_hub:plan_approval");
    const rationale =
      "A reviewable plan is required before mutation. Approve, edit, or reject the plan to continue.";
    const suspendKind = hubSuspendKind(
      planApprovalVerdict,
      "plan_approval_required",
    ) as NonNullable<AgentRunResult["suspension"]>["kind"];
    if (runtime.deps.checkpointStore) {
      await saveSuspendedRun({
        store: runtime.deps.checkpointStore,
        checkpoint: {
          runId,
          requestId: shared.requestId,
          suspensionKind: suspendKind,
          input,
          decision,
          pinnedState: shared.pinnedState,
          messages: [],
          toolCacheEntries: [],
          pendingApproval: undefined,
          plan,
          ...(planStrategy ? { planStrategy } : {}),
          changedFiles: [],
          mutationCheckpointIds: [],
          reasonCodes,
          warnings,
          usage: budget.snapshot(),
          startedAtMs: startedMs,
          repoBuildStateBefore: shared.repoBuildStateBefore,
          repoBuildStateAfter: shared.repoBuildStateAfter,
          ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
          ...(taskListRef.completedPlanStepIds &&
          taskListRef.completedPlanStepIds.length > 0
            ? {
                completedPlanStepIds: [...taskListRef.completedPlanStepIds],
              }
            : {}),
          ...(shared.executionSeed
            ? { executionSeed: shared.executionSeed }
            : {}),
          ...(shared.understanding
            ? { understanding: shared.understanding }
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
    return {
      kind: "terminal",
      result: finish({
        status: "suspended",
        route: decision.route,
        planningDepth: decision.planningDepth,
        plan,
        answer: formatPlanAnswerWithNextPhase({
          answer: formatPlanAsAnswer(plan, planStrategy, clarifyDraft),
          nextPlanPhaseOffer: shared.nextPlanPhaseOffer,
          reasonCodes,
        }),
        suspension: {
          kind: suspendKind,
          rationale,
          plan,
        },
        reasonCodes,
      }),
    };
  }

  if (envelope.mode === "plan") {
    reasonCodes.push("plan_mode_completed", "answer_produced");
    await runtime.safeUnpin(runId, shared.pinnedState);
    return {
      kind: "terminal",
      result: finish({
        status: "completed",
        route: decision.route,
        planningDepth: decision.planningDepth,
        plan,
        answer: formatPlanAnswerWithNextPhase({
          answer: formatPlanAsAnswer(plan, planStrategy, clarifyDraft),
          nextPlanPhaseOffer: shared.nextPlanPhaseOffer,
          reasonCodes,
        }),
        reasonCodes,
      }),
    };
  }

  return undefined;
}
