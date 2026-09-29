import type { VerificationRecord } from "../../../modules/verification";

import {
  applyExplorationSignal,
  clampRunBudget,
  toRunUsage,
} from "../../agent-engine/actions";
import { buildBudgetWallResetMessage } from "../../agent-engine/actions/buildStallContinueRationale";
import type { BudgetWallReason } from "../../agent-engine/actions/buildStallContinueRationale";
import { AGENT_ENGINE_SCHEMA_VERSION } from "../../agent-engine/constants";
import {
  AgentEngineError,
  agentRunBudgetSchema,
  agentRunResultSchema,
} from "../contracts";
import type {
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import { EventBus } from "../../agent-engine/internal/EventBus";
import { RunBudgetTracker } from "../../agent-engine/internal/RunBudget";
import type { TaskListRef } from "../../agent-engine/internal/taskListRuntime";
import type { AgentEngineRuntime } from "../../agent-engine/pipeline/runtime";
import { resolveWorkspaceId } from "../../agent-engine/pipeline/runtime";
import {
  commitMutations,
  persistVerificationArtifact,
} from "../../agent-engine/pipeline/verification";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  executeOneTool,
} from "../../agent-engine/pipeline/executeTool";
import { ReadLedger } from "../../agent-engine/internal/ReadLedger";
import { ToolCallCache } from "../../agent-engine/internal/ToolCallCache";

import { executeV8Start } from "./executeStart";
import { resumeV8ToolLoopFromCheckpoint } from "./resumeToolLoop";

/**
 * Resume a suspended v8-engine run (Continue / clarify / plan / approval).
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

  const finish = (
    partial: Omit<
      AgentRunResult,
      | "schemaVersion"
      | "runId"
      | "requestId"
      | "usage"
      | "durationMs"
      | "warnings"
      | "reasonCodes"
    > & {
      reasonCodes?: AgentReasonCode[];
      warnings?: string[];
    },
  ): AgentRunResult => {
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

  try {
    if (signal.aborted) {
      return await cancelledResult();
    }

    if (checkpoint.suspensionKind === "clarification_required") {
      if (!input.clarificationAnswer) {
        throw new AgentEngineError(
          "invalid_input",
          "Resuming a clarification-required run requires clarificationAnswer.",
        );
      }
      await runtime.deps.checkpointStore.delete(runId);
      reasonCodes.push("resume_complete");
      const amended: AgentEngineStartInput = {
        ...startInput,
        request: {
          ...startInput.request,
          userMessage: `${startInput.request.userMessage}\n\nClarification: ${input.clarificationAnswer}`,
        },
        conversation: [
          ...startInput.conversation,
          { role: "user", content: input.clarificationAnswer },
        ],
      };
      return executeV8Start(runtime, {
        runId,
        input: amended,
        bus,
        signal,
        getCancelReason,
      });
    }

    if (checkpoint.suspensionKind === "plan_approval_required") {
      if (!input.planDecision) {
        throw new AgentEngineError(
          "invalid_input",
          "Resuming a plan-approval run requires planDecision.",
        );
      }
      if (input.planDecision.decision === "rejected") {
        await runtime.deps.checkpointStore.delete(runId);
        await runtime.safeUnpin(runId, pinnedState);
        reasonCodes.push("plan_rejected", "resume_complete");
        return finish({
          status: "cancelled",
          reasonCodes,
          error: { code: "cancelled", message: "Plan rejected by user." },
        });
      }
      await runtime.deps.checkpointStore.delete(runId);
      reasonCodes.push("resume_complete");
      const plan =
        input.planDecision.decision === "edited"
          ? input.planDecision.plan
          : (input.planDecision.plan ?? checkpoint.plan);
      return executeV8Start(runtime, {
        runId,
        input: startInput,
        bus,
        signal,
        getCancelReason,
        approvedPlan: plan,
        approvedPlanStrategy: checkpoint.planStrategy,
        skipPlanGate: true,
        planSource: "resume_approval",
      });
    }

    if (checkpoint.suspensionKind === "continue_required") {
      if (!input.continueDecision) {
        throw new AgentEngineError(
          "invalid_input",
          "Resuming a continue-required run requires continueDecision.",
        );
      }
      if (input.continueDecision.decision === "stop") {
        await runtime.deps.checkpointStore.delete(runId);
        commitMutations(runtime, checkpoint.mutationCheckpointIds, {
          runId,
          bus,
          warnings,
          logVerbosity: startInput.logVerbosity,
        });
        await runtime.safeUnpin(runId, pinnedState);
        reasonCodes.push("stall_continue_stopped", "resume_complete");
        return finish({
          status: "completed",
          answer: checkpoint.continuePartialAnswer,
          reasonCodes,
        });
      }

      reasonCodes.push("stall_continue_approved", "resume_complete");
      const nextOverrideCount = (checkpoint.continueOverrideCount ?? 0) + 1;
      const wallReason: BudgetWallReason =
        checkpoint.continueWallReason ?? "exploration_stall";
      const mutationRequired =
        decision.toolGrant.maximumWorkspaceEffect === "write";
      const resetMessage = buildBudgetWallResetMessage({
        reason: wallReason,
        guidance: input.continueDecision.guidance?.trim(),
        mutationRequired,
        changedFiles: checkpoint.changedFiles,
      });
      await runtime.deps.checkpointStore.delete(runId);
      return resumeV8ToolLoopFromCheckpoint(runtime, {
        runId,
        requestId,
        checkpoint: {
          ...checkpoint,
          continueOverrideCount: nextOverrideCount,
        },
        startInput,
        decision,
        bus,
        signal,
        budget,
        reasonCodes,
        warnings,
        taskListRef,
        windowPolicy,
        pinnedState,
        finish,
        cancelledResult,
        repoBuildStateAfter,
        onRepoBuildStateAfter: (state) => {
          repoBuildStateAfter = state;
        },
        onVerificationRecord: (record) => {
          verificationRecord = record;
        },
        continueOverrideCount: nextOverrideCount,
        prependMessages: [{ role: "user", content: resetMessage }],
      });
    }

    if (checkpoint.suspensionKind === "approval_required") {
      if (!input.approval || !checkpoint.pendingApproval) {
        throw new AgentEngineError(
          "invalid_input",
          "Resuming an approval-required run requires approval.",
        );
      }
      if (input.approval.decision === "denied") {
        await runtime.deps.checkpointStore.delete(runId);
        await runtime.safeUnpin(runId, pinnedState);
        reasonCodes.push("approval_denied", "resume_complete");
        return finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "approval_denied",
            message: "Mutation approval denied.",
          },
        });
      }

      reasonCodes.push("resume_complete");
      const toolCache = ToolCallCache.fromEntries(checkpoint.toolCacheEntries);
      const messages = [...checkpoint.messages];
      const changedFiles = [...checkpoint.changedFiles];
      const mutationCheckpointIds = [...checkpoint.mutationCheckpointIds];
      const pending = checkpoint.pendingApproval;
      const outcome = await executeOneTool(runtime, {
        runId,
        toolCall: {
          id: pending.callId,
          name: pending.toolName,
          arguments: JSON.stringify(pending.arguments ?? {}),
        },
        grant: decision.toolGrant,
        pinnedState,
        workspaceRoot: startInput.workspaceRoot ?? ".",
        bus,
        signal,
        toolCache,
        readLedger: new ReadLedger(),
        budget,
        warnings,
        reasonCodes,
        dirtyPaths: startInput.dirtyPaths,
        changedFiles,
        mutationCheckpointIds,
        approvalToken: {
          approvalId: pending.approvalId,
          fingerprint: pending.fingerprint,
          decision: "approved",
        },
        taskListRef,
        taskListAutoAdvance: runtime.deps.taskListAutoAdvance === true,
        taskListAutoAdvanceBudget: { remaining: 0 },
        mutatingToolNames: DEFAULT_MUTATING_TOOL_NAMES,
        windowPolicy,
      });
      if (outcome.kind === "message") {
        messages.push(outcome.message);
      }
      await runtime.deps.checkpointStore.delete(runId);
      return resumeV8ToolLoopFromCheckpoint(runtime, {
        runId,
        requestId,
        checkpoint: {
          ...checkpoint,
          messages,
          toolCacheEntries: toolCache.entries(),
          changedFiles,
          mutationCheckpointIds,
          pendingApproval: undefined,
        },
        startInput,
        decision,
        bus,
        signal,
        budget,
        reasonCodes,
        warnings,
        taskListRef,
        windowPolicy,
        pinnedState,
        finish,
        cancelledResult,
        repoBuildStateAfter,
        onRepoBuildStateAfter: (state) => {
          repoBuildStateAfter = state;
        },
        onVerificationRecord: (record) => {
          verificationRecord = record;
        },
        continueOverrideCount: checkpoint.continueOverrideCount,
      });
    }

    // grant_expansion_required and unknown kinds
    throw new AgentEngineError(
      "invalid_input",
      `V8 Engine resume does not yet handle suspension kind "${checkpoint.suspensionKind}".`,
    );
  } catch (error) {
    if (error instanceof AgentEngineError) {
      throw error;
    }
    await runtime.safeUnpin(runId, pinnedState);
    if (signal.aborted) {
      return await cancelledResult();
    }
    return finish({
      status: "failed",
      reasonCodes: [...reasonCodes, "provider_failed"],
      error: {
        code: "execution_failed",
        message: error instanceof Error ? error.message : "Resume failed.",
      },
    });
  }
}
