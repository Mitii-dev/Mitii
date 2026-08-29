import type {
  ModelMessage,
  ModelToolCall,
} from "../../../modules/model-gateway";
import {
  formatPlanAsAnswer,
  inferPlanStrategyFromArtifact,
} from "../../../modules/planning";
import type { ToolApprovalToken } from "../../tool-runtime";
import type {
  VerificationRecord,
} from "../../../modules/verification";

import {
  amendMessageWithClarification,
  annotateMutationToolDefinitions,
  applyExplorationSignal,
  clampRunBudget,
  toRunUsage,
  filterToolDefinitions,
} from "../actions";
import type {
  EstablishedFact,
} from "../actions";
import { ToolCallCache } from "../internal/ToolCallCache";
import { AGENT_ENGINE_SCHEMA_VERSION } from "../constants";
import {
  agentRunBudgetSchema,
  agentRunResultSchema,
  AgentEngineError,
} from "../contracts";
import type {
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  logVerbosityAtLeast,
} from "../internal/logVerbosity";
import {
  attachTaskListTool,
  type TaskListRef,
} from "../internal/taskListRuntime";
import {
  DEFAULT_TOOL_DEFINITIONS,
} from "../policy";
import { resolveAgentEngineThresholds } from "../actions/resolveAgentEngineThresholds";

import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";

import { executeStart } from "./executeStart";
import { DEFAULT_MUTATING_TOOL_NAMES, executeOneTool } from "./executeTool";
import { runModelToolLoop } from "./modelToolLoop";
import { finishAfterLoop, persistVerificationArtifact } from "./verification";

export async function executeResume(
  runtime: AgentEngineRuntime,
  params: {
  input: AgentEngineResumeInput;
  bus: EventBus;
  signal: AbortSignal;
  getCancelReason: () => string | undefined;
}): Promise<AgentRunResult> {
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
  const excludedWaitMs =
    (checkpoint.excludedWaitMs ?? 0) + suspensionWaitMs;
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
  if (
    resumeBudgetClamp.clamped.length > 0 &&
    logVerbosityAtLeast(startInput.logVerbosity, "standard")
  ) {
    for (const field of resumeBudgetClamp.clamped) {
      runtime.emit(bus, {
        type: "warning",
        runId,
        message: `Run budget "${field.field}" reduced from ${field.requested} to ${field.effective} by the window policy.`,
        code: "run_budget_clamped",
        data: {
          field: field.field,
          requested: field.requested,
          effective: field.effective,
        },
        at: runtime.isoNow(),
      });
    }
  }

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
      const clarifiedMessage = amendMessageWithClarification(
        startInput.request.userMessage,
        input.clarificationAnswer,
      );
      const amendedInput: AgentEngineStartInput = {
        ...startInput,
        request: {
          ...startInput.request,
          userMessage: clarifiedMessage,
        },
        conversation: [
          ...startInput.conversation,
          { role: "user", content: input.clarificationAnswer },
        ],
      };
      return executeStart(runtime, {
        runId,
        input: amendedInput,
        bus,
        signal,
        getCancelReason,
      });
    }

    if (checkpoint.suspensionKind === "plan_approval_required") {
      if (!input.planDecision) {
        throw new AgentEngineError(
          "invalid_input",
          "Resuming a plan-approval-required run requires planDecision.",
        );
      }

      if (input.planDecision.decision === "rejected") {
        await runtime.deps.checkpointStore.delete(runId);
        await runtime.safeUnpin(runId, pinnedState);
        reasonCodes.push("plan_rejected", "resume_complete");
        return finish({
          status: "cancelled",
          plan: checkpoint.plan,
          answer: checkpoint.plan
            ? formatPlanAsAnswer(checkpoint.plan)
            : undefined,
          reasonCodes,
          error: {
            code: "plan_rejected",
            message: "The proposed plan was rejected.",
          },
        });
      }

      const nextPlan =
        input.planDecision.plan ??
        checkpoint.plan;
      if (!nextPlan) {
        throw new AgentEngineError(
          "invalid_input",
          "Plan approval resume is missing a plan artifact.",
        );
      }

      await runtime.deps.checkpointStore.delete(runId);
      reasonCodes.push(
        input.planDecision.decision === "edited"
          ? "plan_edited"
          : "plan_approved",
        "resume_complete",
      );
      return executeStart(runtime, {
        runId,
        input: startInput,
        bus,
        signal,
        getCancelReason,
        approvedPlan: nextPlan,
        approvedPlanStrategy:
          input.planDecision.decision === "edited"
            ? inferPlanStrategyFromArtifact(nextPlan)
            : checkpoint.planStrategy ?? inferPlanStrategyFromArtifact(nextPlan),
        skipPlanGate: true,
        planSource: "resume_approval",
      });
    }

    // suspensionKind === "approval_required"
    if (!input.approval) {
      throw new AgentEngineError(
        "invalid_input",
        "Resuming an approval-required run requires an approval decision.",
      );
    }
    const pending = checkpoint.pendingApproval;
    if (!pending || pending.approvalId !== input.approval.approvalId) {
      throw new AgentEngineError(
        "invalid_input",
        "Approval id does not match the pending checkpoint.",
      );
    }

    if (input.approval.decision === "denied") {
      await runtime.deps.checkpointStore.delete(runId);
      await runtime.safeUnpin(runId, pinnedState);
      reasonCodes.push("approval_denied");
      return finish({
        status: "approval_denied",
        reasonCodes,
        error: {
          code: "approval_denied",
          message: "The requested mutation was denied.",
        },
      });
    }

    reasonCodes.push("approval_granted", "resume_complete");

    if (!runtime.deps.tools) {
      await runtime.safeUnpin(runId, pinnedState);
      return finish({
        status: "failed",
        reasonCodes: [...reasonCodes, "misconfigured"],
        error: {
          code: "misconfigured",
          message: "Model requested tools but Tool Runtime is not configured.",
        },
      });
    }
    if (!startInput.workspaceRoot) {
      await runtime.safeUnpin(runId, pinnedState);
      return finish({
        status: "failed",
        reasonCodes: [...reasonCodes, "misconfigured"],
        error: {
          code: "misconfigured",
          message: "workspaceRoot is required to resume a mutation.",
        },
      });
    }

    const messages: ModelMessage[] = [...checkpoint.messages];
    const toolCache = ToolCallCache.fromEntries(checkpoint.toolCacheEntries);
    const changedFiles = [...checkpoint.changedFiles];
    const mutationCheckpointIds = [...checkpoint.mutationCheckpointIds];
    const establishedFacts: EstablishedFact[] = [];

    const approvalToken: ToolApprovalToken = {
      approvalId: pending.approvalId,
      fingerprint: pending.fingerprint,
      decision: "approved",
    };
    const pendingToolCall: ModelToolCall = {
      id: pending.callId,
      name: pending.toolName,
      arguments: JSON.stringify(pending.arguments ?? {}),
    };

    const toolOutcome = await executeOneTool(runtime, {
      runId,
      toolCall: pendingToolCall,
      grant: decision.toolGrant,
      pinnedState,
      workspaceRoot: startInput.workspaceRoot,
      bus,
      signal,
      toolCache,
      budget,
      warnings,
      reasonCodes,
      dirtyPaths: startInput.dirtyPaths,
      changedFiles,
      mutationCheckpointIds,
      approvalToken,
      taskListRef,
      taskListAutoAdvance: runtime.deps.taskListAutoAdvance === true,
      taskListAutoAdvanceBudget: {
        remaining: runtime.deps.taskListAutoAdvance === true ? 1 : 0,
      },
      mutatingToolNames: DEFAULT_MUTATING_TOOL_NAMES,
      // Approval resume already passed any pre-mutation gates.
      changeImpactGate: { required: false, satisfied: true },
      windowPolicy,
      plan: checkpoint.plan,
    });

    if (toolOutcome.kind === "approval_required") {
      // Tool Runtime did not accept the approval token (mismatch/expired).
      await runtime.safeUnpin(runId, pinnedState);
      await runtime.deps.checkpointStore.delete(runId);
      return finish({
        status: "failed",
        reasonCodes: [...reasonCodes, "misconfigured"],
        error: {
          code: "approval_required",
          message: "Approval was not accepted for the pending mutation.",
        },
      });
    }

    messages.push(toolOutcome.message);
    await runtime.deps.checkpointStore.delete(runId);

    const toolDefinitions = annotateMutationToolDefinitions(
      attachTaskListTool({
        mode: startInput.request.mode,
        tools: filterToolDefinitions({
          grant: decision.toolGrant,
          definitions:
            startInput.tools ??
            runtime.deps.toolDefinitions ??
            DEFAULT_TOOL_DEFINITIONS,
          supportsTools: runtime.deps.llm.capabilities.supportsTools,
        }),
      }),
      decision.toolGrant.mutationBudget,
    );

    const loopOutcome = await runModelToolLoop(runtime, {
      runId,
      request: {
        messages: [...messages],
        model: startInput.model,
        temperature: startInput.temperature,
        stream: startInput.stream,
        tools: toolDefinitions,
      },
      decision,
      dirtyPaths: startInput.dirtyPaths,
      pinnedState,
      workspaceRoot: startInput.workspaceRoot,
      bus,
      signal,
      budget,
      reasonCodes,
      warnings,
      messages,
      toolCache,
      changedFiles,
      mutationCheckpointIds,
      taskListRef,
      establishedFacts,
      windowPolicy,
      repoBuildStateBefore: checkpoint.repoBuildStateBefore,
      logVerbosity: startInput.logVerbosity,
      reserveVerificationRepairModelCalls: true,
      plan: checkpoint.plan,
      thresholds: resolveAgentEngineThresholds(startInput.loopPolicy?.thresholds),
    });

    return await finishAfterLoop(runtime, {
      runId,
      requestId,
      input: startInput,
      request: {
        messages: [...messages],
        model: startInput.model,
        temperature: startInput.temperature,
        stream: startInput.stream,
        tools: toolDefinitions,
      },
      decision,
      bus,
      signal,
      pinnedState,
      dirtyPaths: startInput.dirtyPaths,
      loopOutcome,
      reasonCodes,
      warnings,
      budget,
      startedAtMs: checkpoint.startedAtMs,
      finish,
      cancelledResult,
      taskListRef,
      repoBuildStateBefore: checkpoint.repoBuildStateBefore,
      repoBuildStateAfter,
      onRepoBuildStateAfter: (state) => {
        repoBuildStateAfter = state;
      },
      onVerificationRecord: (record) => {
        verificationRecord = record;
      },
      windowPolicy,
      loopContext: {
        establishedFacts,
        plan: checkpoint.plan,
      },
    });
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
        message:
          error instanceof Error ? error.message : "Agent resume failed.",
      },
    });
  }
}
