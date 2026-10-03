import type { VerificationRecord } from "../../../modules/verification";

import {
  applyExplorationSignal,
  clampRunBudget,
  isProviderInfrastructureFailure,
  toRunUsage,
} from "../actions";
import { AGENT_ENGINE_SCHEMA_VERSION } from "../legacy/constants";
import {
  AgentEngineError,
  agentRunBudgetSchema,
  agentRunResultSchema,
} from "../contracts";
import type {
  AgentEngineResumeInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import { persistVerificationArtifact } from "./verification";
import {
  handleApprovalResume,
  handleClarificationResume,
  handleContinueResume,
  handleGrantExpansionResume,
  handlePlanApprovalResume,
  type ResumeFinish,
  type ResumeHandlerContext,
} from "./executeResumeHandlers";

/**
 * Resume a suspended v8-engine run (Continue / clarify / plan / approval /
 * grant expansion).
 */
export async function executeV8Resume(
  runtime: AgentEngineRuntime,
  params: {
    input: AgentEngineResumeInput;
    bus: EventBus;
    signal: AbortSignal;
    getCancelReason: () => string | undefined;
  },
): Promise<AgentRunResult> {
  const { input, bus, signal, getCancelReason } = params;
  const runId = input.runId;

  if (!runtime.deps.checkpointStore) {
    throw new AgentEngineError(
      "misconfigured_ports",
      "Resume requires a checkpoint store.",
    );
  }

  const checkpoint = await runtime.deps.checkpointStore.load(runId);
  if (!checkpoint) {
    throw new AgentEngineError(
      "invalid_input",
      `No suspended run checkpoint found for run "${runId}".`,
    );
  }
  if (checkpoint.contextEpoch) {
    runtime.contextEpochs.set(runId, checkpoint.contextEpoch);
  }

  const requestId = checkpoint.requestId;
  const decision = input.approvalMode
    ? {
        ...checkpoint.decision,
        toolGrant: {
          ...checkpoint.decision.toolGrant,
          approvalMode: input.approvalMode,
        },
      }
    : checkpoint.decision;
  const startInput = input.approvalMode
    ? { ...checkpoint.input, approvalMode: input.approvalMode }
    : checkpoint.input;
  const windowPolicy = runtime.resolveWindowPolicy(startInput);
  const taskListRef: TaskListRef = {
    current: checkpoint.taskList,
    maxTasks: windowPolicy.taskList.maxTasks,
    completedPlanStepIds: [...(checkpoint.completedPlanStepIds ?? [])],
  };
  const pinnedState = checkpoint.pinnedState;
  const reasonCodes: AgentReasonCode[] = [...checkpoint.reasonCodes];
  const warnings: string[] = [...checkpoint.warnings];
  let repoBuildStateAfter = checkpoint.repoBuildStateAfter;
  let verificationRecord: VerificationRecord | undefined;
  const resumedAtMs = Date.now();
  const suspensionWaitMs =
    checkpoint.suspendedAtMs !== undefined
      ? Math.max(0, resumedAtMs - checkpoint.suspendedAtMs)
      : 0;
  const excludedWaitMs = (checkpoint.excludedWaitMs ?? 0) + suspensionWaitMs;
  const resumeBudgetClamp = clampRunBudget(
    agentRunBudgetSchema.parse(startInput.budget ?? {}),
    windowPolicy,
  );
  const budget = new RunBudgetTracker(
    resumeBudgetClamp.budget,
    checkpoint.startedAtMs,
    checkpoint.usage,
    excludedWaitMs,
  );

  const finish: ResumeFinish = (partial) => {
    const usageSnap = budget.snapshot();
    const finalReasonCodes = [...(partial.reasonCodes ?? reasonCodes)];
    const finalWarnings = [...warnings, ...(partial.warnings ?? [])];
    applyExplorationSignal(usageSnap, finalReasonCodes, finalWarnings);
    const result = agentRunResultSchema.parse({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId,
      requestId,
      status: partial.status,
      route: partial.route ?? decision.route,
      planningDepth: partial.planningDepth ?? decision.planningDepth,
      answer: partial.answer,
      plan: partial.plan ?? checkpoint.plan,
      ...(partial.planStrategy ?? checkpoint.planStrategy
        ? {
            planStrategy: partial.planStrategy ?? checkpoint.planStrategy,
          }
        : {}),
      ...(startInput.request.mode !== "ask" &&
      (partial.taskList ?? taskListRef.current)
        ? { taskList: partial.taskList ?? taskListRef.current }
        : {}),
      repoBuildStateBefore: checkpoint.repoBuildStateBefore,
      repoBuildStateAfter,
      ...(verificationRecord ? { verificationRecord } : {}),
      suspension: partial.suspension,
      pinnedState: partial.pinnedState ?? pinnedState,
      reasonCodes: finalReasonCodes,
      warnings: finalWarnings,
      usage: toRunUsage(usageSnap),
      durationMs: Date.now() - checkpoint.startedAtMs,
      error: partial.error,
    });
    runtime.emit(bus, {
      type: "terminal",
      runId,
      status: result.status,
      result,
      at: runtime.isoNow(),
    });
    return result;
  };

  const cancelledResult = async (): Promise<AgentRunResult> => {
    verificationRecord =
      (await persistVerificationArtifact(runtime, {
        runId,
        requestId,
        workspaceId: resolveWorkspaceId(startInput),
        bus,
        reasonCodes,
        warnings,
        status: "cancelled",
        before: checkpoint.repoBuildStateBefore,
        after: repoBuildStateAfter,
        previous: verificationRecord,
        logVerbosity: startInput.logVerbosity,
      })) ?? verificationRecord;
    return finish({
      status: "cancelled",
      reasonCodes: [...reasonCodes, "cancelled"],
      error: {
        code: "cancelled",
        message: getCancelReason() ?? "Run cancelled.",
      },
    });
  };

  const ctx: ResumeHandlerContext = {
    runtime,
    runId,
    requestId,
    input,
    checkpoint,
    startInput,
    decision,
    bus,
    signal,
    getCancelReason,
    budget,
    reasonCodes,
    warnings,
    taskListRef,
    windowPolicy,
    pinnedState,
    finish,
    cancelledResult,
    repoBuildStateAfter,
    setRepoBuildStateAfter: (state) => {
      repoBuildStateAfter = state;
    },
    setVerificationRecord: (record) => {
      verificationRecord = record;
    },
    resumeBudget: resumeBudgetClamp.budget,
    excludedWaitMs,
  };

  try {
    if (signal.aborted) {
      return await cancelledResult();
    }

    switch (checkpoint.suspensionKind) {
      case "clarification_required":
        return await handleClarificationResume(ctx);
      case "plan_approval_required":
        return await handlePlanApprovalResume(ctx);
      case "grant_expansion_required":
        return await handleGrantExpansionResume(ctx);
      case "continue_required":
        return await handleContinueResume(ctx);
      case "approval_required":
        return await handleApprovalResume(ctx);
      default:
        throw new AgentEngineError(
          "invalid_input",
          `V8 Engine resume does not handle suspension kind "${checkpoint.suspensionKind}".`,
        );
    }
  } catch (error) {
    if (error instanceof AgentEngineError) {
      throw error;
    }
    await runtime.safeUnpin(runId, pinnedState);
    if (signal.aborted) {
      return await cancelledResult();
    }
    const message =
      error instanceof Error ? error.message : "Resume failed.";
    const infrastructure = isProviderInfrastructureFailure({
      errorMessage: message,
    });
    return finish({
      status: "failed",
      reasonCodes: [
        ...reasonCodes,
        "provider_failed",
        ...(infrastructure
          ? (["provider_infrastructure_unavailable"] as const)
          : []),
      ],
      error: {
        code: infrastructure ? "provider_unavailable" : "execution_failed",
        message,
      },
    });
  }
}

/** Alias for hosts / legacy re-exports that expect `executeResume`. */
export const executeResume = executeV8Resume;
