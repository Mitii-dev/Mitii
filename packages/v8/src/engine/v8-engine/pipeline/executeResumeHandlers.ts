import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { PlanArtifact } from "../../../modules/planning";
import {
  formatPlanAsAnswer,
  inferPlanStrategyFromArtifact,
} from "../../../modules/planning";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { VerificationRecord } from "../../../modules/verification";
import type { ToolApprovalToken } from "../../tool-runtime";

import {
  amendMessageWithClarification,
  resolveClarificationAnswer,
  buildBudgetWallResetMessage,
  buildPreflightDiagnosticRepairInstruction,
  resolveLoopPolicyThresholds,
} from "../actions";
import { formatClarificationAnswerFromPatch } from "../../../modules/request-understanding/intent/applyClarificationFactPatch";
import type { BudgetWallReason } from "../actions/buildStallContinueRationale";
import {
  AgentEngineError,
} from "../contracts";
import type {
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunBudget,
  AgentRunResult,
} from "../contracts";
import type { AgentRunCheckpoint } from "../internal/RunCheckpoint";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import { ReadLedger } from "../internal/ReadLedger";
import { ToolCallCache } from "../internal/ToolCallCache";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import { commitMutations } from "./verification";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  executeOneTool,
} from "./executeTool";
import { executeV8Start } from "./executeStart";
import { resumeV8ToolLoopFromCheckpoint } from "./resumeToolLoop";

export type ResumeFinish = (
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
) => AgentRunResult;

export type ResumeHandlerContext = {
  runtime: AgentEngineRuntime;
  runId: string;
  requestId: string;
  input: AgentEngineResumeInput;
  checkpoint: AgentRunCheckpoint;
  startInput: AgentEngineStartInput;
  decision: ExecutionDecision;
  bus: EventBus;
  signal: AbortSignal;
  getCancelReason: () => string | undefined;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  taskListRef: TaskListRef;
  windowPolicy: WindowPolicy;
  pinnedState: AgentRunCheckpoint["pinnedState"];
  finish: ResumeFinish;
  cancelledResult: () => Promise<AgentRunResult>;
  repoBuildStateAfter: AgentRunCheckpoint["repoBuildStateAfter"];
  setRepoBuildStateAfter: (
    state: NonNullable<AgentRunCheckpoint["repoBuildStateAfter"]>,
  ) => void;
  setVerificationRecord: (record: VerificationRecord) => void;
  resumeBudget: AgentRunBudget;
  excludedWaitMs: number;
};

export async function handleClarificationResume(
  ctx: ResumeHandlerContext,
): Promise<AgentRunResult> {
  const {
    runtime,
    runId,
    input,
    checkpoint,
    startInput,
    bus,
    signal,
    getCancelReason,
    reasonCodes,
  } = ctx;
  if (!input.clarificationAnswer) {
    throw new AgentEngineError(
      "invalid_input",
      "Resuming a clarification-required run requires clarificationAnswer.",
    );
  }
  await runtime.deps.checkpointStore!.delete(runId);
  reasonCodes.push("resume_complete");
  const patch = resolveClarificationAnswer(
    input.clarificationAnswer,
    checkpoint.clarificationSession,
  );
  const displayAnswer = patch
    ? formatClarificationAnswerFromPatch(patch)
    : input.clarificationAnswer;
  const clarifiedMessage = amendMessageWithClarification(
    startInput.request.userMessage,
    displayAnswer,
  );
  const amendedInput: AgentEngineStartInput = {
    ...startInput,
    request: {
      ...startInput.request,
      userMessage: clarifiedMessage,
    },
    conversation: [
      ...startInput.conversation,
      { role: "user", content: displayAnswer },
    ],
    ...(patch
      ? {
          clarificationResolution: {
            optionId: patch.optionId,
            ...(patch.label ? { label: patch.label } : {}),
            ...(patch.interactionIntent
              ? { interactionIntent: patch.interactionIntent }
              : {}),
            ...(patch.primaryTaskIntent
              ? { primaryTaskIntent: patch.primaryTaskIntent }
              : {}),
            ...(patch.targetPath ? { targetPath: patch.targetPath } : {}),
            ...(patch.scopeHint ? { scopeHint: patch.scopeHint } : {}),
            ...(patch.outcomeNote ? { outcomeNote: patch.outcomeNote } : {}),
          },
        }
      : {}),
  };
  return executeV8Start(runtime, {
    runId,
    input: amendedInput,
    bus,
    signal,
    getCancelReason,
  });
}

export async function handlePlanApprovalResume(
  ctx: ResumeHandlerContext,
): Promise<AgentRunResult> {
  const {
    runtime,
    runId,
    input,
    checkpoint,
    startInput,
    bus,
    signal,
    getCancelReason,
    pinnedState,
    reasonCodes,
    finish,
  } = ctx;
  if (!input.planDecision) {
    throw new AgentEngineError(
      "invalid_input",
      "Resuming a plan-approval run requires planDecision.",
    );
  }
  if (input.planDecision.decision === "rejected") {
    await runtime.deps.checkpointStore!.delete(runId);
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

  const nextPlan: PlanArtifact | undefined =
    input.planDecision.plan ?? checkpoint.plan;
  if (!nextPlan) {
    throw new AgentEngineError(
      "invalid_input",
      "Plan approval resume is missing a plan artifact.",
    );
  }

  await runtime.deps.checkpointStore!.delete(runId);
  reasonCodes.push(
    input.planDecision.decision === "edited"
      ? "plan_edited"
      : "plan_approved",
    "resume_complete",
  );
  return executeV8Start(runtime, {
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

export async function handleGrantExpansionResume(
  ctx: ResumeHandlerContext,
): Promise<AgentRunResult> {
  const {
    runtime,
    runId,
    requestId,
    input,
    checkpoint,
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
    setRepoBuildStateAfter,
    setVerificationRecord,
  } = ctx;
  if (!input.grantExpansion) {
    throw new AgentEngineError(
      "invalid_input",
      "Resuming a grant-expansion-required run requires grantExpansion.",
    );
  }
  const pending = checkpoint.pendingGrantExpansion;
  if (!pending || pending.expansionId !== input.grantExpansion.expansionId) {
    throw new AgentEngineError(
      "invalid_input",
      "Grant expansion id does not match the pending checkpoint.",
    );
  }

  if (input.grantExpansion.decision === "denied") {
    await runtime.deps.checkpointStore!.delete(runId);
    await runtime.safeUnpin(runId, pinnedState);
    reasonCodes.push("grant_expansion_denied");
    return finish({
      status: "approval_denied",
      reasonCodes,
      error: {
        code: "grant_expansion_denied",
        message: "Workspace access expansion was denied.",
      },
    });
  }

  if (!runtime.deps.decision?.widen) {
    await runtime.safeUnpin(runId, pinnedState);
    return finish({
      status: "failed",
      reasonCodes: [...reasonCodes, "misconfigured"],
      error: {
        code: "misconfigured",
        message: "Decision policy widen is not configured.",
      },
    });
  }

  const widenedDecision = runtime.deps.decision.widen({
    previous: decision,
    extraPaths: pending.extraPaths,
    extraAllowedRoots: pending.externalRoots,
  });
  reasonCodes.push(
    "grant_expansion_approved",
    "grant_expanded",
    "resume_complete",
  );

  const toolCache = ToolCallCache.fromEntries(checkpoint.toolCacheEntries);
  const messages = [...checkpoint.messages];
  const changedFiles = [...checkpoint.changedFiles];
  const mutationCheckpointIds = [...checkpoint.mutationCheckpointIds];

  for (const pendingCall of pending.pendingToolCalls ?? []) {
    toolCache.delete(pendingCall.callId);
    const outcome = await executeOneTool(runtime, {
      runId,
      toolCall: {
        id: pendingCall.callId,
        name: pendingCall.toolName,
        arguments: JSON.stringify(pendingCall.arguments ?? {}),
      },
      grant: widenedDecision.toolGrant,
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
      approvalToken: undefined,
      taskListRef,
      taskListAutoAdvance: runtime.deps.taskListAutoAdvance === true,
      taskListAutoAdvanceBudget: { remaining: 0 },
      mutatingToolNames: DEFAULT_MUTATING_TOOL_NAMES,
      windowPolicy,
    });
    if (outcome.kind === "message") {
      messages.push(outcome.message);
    } else if (outcome.kind === "approval_required") {
      // Widened grant still needs mutation approval — suspend for that next.
      await runtime.deps.checkpointStore!.delete(runId);
      const approvalId = runtime.deps.idGenerator.next("appr");
      await runtime.deps.checkpointStore!.save({
        ...checkpoint,
        suspensionKind: "approval_required",
        decision: widenedDecision,
        messages,
        toolCacheEntries: toolCache.entries(),
        changedFiles,
        mutationCheckpointIds,
        pendingGrantExpansion: undefined,
        pendingApproval: {
          approvalId,
          fingerprint: outcome.fingerprint,
          toolName: outcome.toolName,
          callId: outcome.callId,
          arguments: outcome.arguments,
          paths: outcome.paths,
        },
        reasonCodes,
        warnings,
        usage: budget.snapshot(),
        suspendedAtMs: Date.now(),
      });
      return finish({
        status: "suspended",
        route: widenedDecision.route,
        planningDepth: widenedDecision.planningDepth,
        suspension: {
          kind: "approval_required",
          rationale: `Mutation approval required after path expansion for ${outcome.toolName}.`,
          approval: {
            approvalId,
            fingerprint: outcome.fingerprint,
            toolName: outcome.toolName,
            callId: outcome.callId,
            paths: outcome.paths,
            arguments: outcome.arguments,
          },
        },
        reasonCodes,
      });
    }
  }

  await runtime.deps.checkpointStore!.delete(runId);

  return resumeV8ToolLoopFromCheckpoint(runtime, {
    runId,
    requestId,
    checkpoint: {
      ...checkpoint,
      messages,
      toolCacheEntries: toolCache.entries(),
      changedFiles,
      mutationCheckpointIds,
      pendingGrantExpansion: undefined,
    },
    startInput,
    decision: widenedDecision,
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
    onRepoBuildStateAfter: setRepoBuildStateAfter,
    onVerificationRecord: setVerificationRecord,
  });
}

export async function handleContinueResume(
  ctx: ResumeHandlerContext,
): Promise<AgentRunResult> {
  const {
    runtime,
    runId,
    requestId,
    input,
    checkpoint,
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
    setRepoBuildStateAfter,
    setVerificationRecord,
    resumeBudget,
    excludedWaitMs,
  } = ctx;
  if (!input.continueDecision) {
    throw new AgentEngineError(
      "invalid_input",
      "Resuming a continue-required run requires continueDecision.",
    );
  }
  if (input.continueDecision.decision === "stop") {
    await runtime.deps.checkpointStore!.delete(runId);
    commitMutations(runtime, checkpoint.mutationCheckpointIds, {
      runId,
      bus,
      warnings,
      logVerbosity: startInput.logVerbosity,
    });
    await runtime.safeUnpin(runId, pinnedState);
    reasonCodes.push("stall_continue_stopped", "resume_complete");
    const partialAnswer = checkpoint.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.content)
      .filter((content) => content.trim().length > 0)
      .pop();
    return finish({
      status: "completed",
      answer: checkpoint.continuePartialAnswer ?? partialAnswer,
      reasonCodes,
    });
  }

  reasonCodes.push("stall_continue_approved", "resume_complete");
  const nextOverrideCount = (checkpoint.continueOverrideCount ?? 0) + 1;
  const guidance = input.continueDecision.guidance?.trim();
  const wallReason: BudgetWallReason =
    checkpoint.continueWallReason ?? "exploration_stall";
  const mutationRequired =
    checkpoint.decision.reasonCodes.includes("mutation_execute") ||
    checkpoint.decision.toolGrant.maximumWorkspaceEffect === "write";
  const remainingBuildState =
    checkpoint.repoBuildStateAfter ?? checkpoint.repoBuildStateBefore;
  const remainingErrorCount = remainingBuildState?.summary.errorCount ?? 0;
  const preflightDiagnostics = buildPreflightDiagnosticRepairInstruction({
    diagnostics: remainingBuildState?.diagnostics ?? [],
    totalErrorCount: remainingErrorCount,
    pathScopes: checkpoint.decision.toolGrant.pathScopes ?? ["."],
    maxDiagnostics: Math.max(12, remainingErrorCount >= 20 ? 24 : 12),
    maxChars: 4_800,
  });
  const resetMessage = buildBudgetWallResetMessage({
    reason: wallReason,
    guidance,
    mutationRequired,
    changedFiles: checkpoint.changedFiles,
    preflightDiagnostics,
  });

  let continueBudget = budget;
  if (wallReason === "budget_exhausted") {
    const bump = resolveLoopPolicyThresholds({
      contextWindowTokens: windowPolicy.contextWindowTokens,
      overrides: startInput.loopPolicy?.thresholds,
    }).thresholds.continueBudgetModelCallBump;
    // resumeBudget is rebuilt from the original start budget on every
    // resume, so the bump must scale with how many Continues were approved.
    const extension = bump * nextOverrideCount;
    continueBudget = new RunBudgetTracker(
      {
        ...resumeBudget,
        maxModelCalls: resumeBudget.maxModelCalls + extension,
        maxToolCalls: resumeBudget.maxToolCalls + extension,
        maxLoopIterations: resumeBudget.maxLoopIterations + extension,
      },
      checkpoint.startedAtMs,
      checkpoint.usage,
      excludedWaitMs,
    );
    warnings.push(
      `Extended run budget by ${extension} model/tool/loop units after Continue.`,
    );
  }

  await runtime.deps.checkpointStore!.delete(runId);
  return resumeV8ToolLoopFromCheckpoint(runtime, {
    runId,
    requestId,
    checkpoint: {
      ...checkpoint,
      continueOverrideCount: nextOverrideCount,
      continueWallReason: wallReason,
      repoBuildStateBefore:
        remainingBuildState ?? checkpoint.repoBuildStateBefore,
    },
    startInput,
    decision,
    bus,
    signal,
    budget: continueBudget,
    reasonCodes,
    warnings,
    taskListRef,
    windowPolicy,
    pinnedState,
    finish,
    cancelledResult,
    repoBuildStateAfter,
    onRepoBuildStateAfter: setRepoBuildStateAfter,
    onVerificationRecord: setVerificationRecord,
    continueOverrideCount: nextOverrideCount,
    prependMessages: [{ role: "user", content: resetMessage }],
  });
}

export async function handleApprovalResume(
  ctx: ResumeHandlerContext,
): Promise<AgentRunResult> {
  const {
    runtime,
    runId,
    requestId,
    input,
    checkpoint,
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
    setRepoBuildStateAfter,
    setVerificationRecord,
  } = ctx;
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
    await runtime.deps.checkpointStore!.delete(runId);
    await runtime.safeUnpin(runId, pinnedState);
    reasonCodes.push("approval_denied", "resume_complete");
    return finish({
      status: "approval_denied",
      reasonCodes,
      error: {
        code: "approval_denied",
        message: "Mutation approval denied.",
      },
    });
  }

  reasonCodes.push("approval_granted", "resume_complete");
  const toolCache = ToolCallCache.fromEntries(checkpoint.toolCacheEntries);
  const messages = [...checkpoint.messages];
  const changedFiles = [...checkpoint.changedFiles];
  const mutationCheckpointIds = [...checkpoint.mutationCheckpointIds];
  const approvalToken: ToolApprovalToken = {
    approvalId: pending.approvalId,
    fingerprint: pending.fingerprint,
    decision: "approved",
  };
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
    approvalToken,
    taskListRef,
    taskListAutoAdvance: runtime.deps.taskListAutoAdvance === true,
    taskListAutoAdvanceBudget: { remaining: 0 },
    mutatingToolNames: DEFAULT_MUTATING_TOOL_NAMES,
    windowPolicy,
  });
  if (outcome.kind === "message") {
    messages.push(outcome.message);
  } else if (outcome.kind === "approval_required") {
    await runtime.safeUnpin(runId, pinnedState);
    await runtime.deps.checkpointStore!.delete(runId);
    return finish({
      status: "failed",
      reasonCodes: [...reasonCodes, "misconfigured"],
      error: {
        code: "approval_required",
        message: "Approval was not accepted for the pending mutation.",
      },
    });
  }
  await runtime.deps.checkpointStore!.delete(runId);
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
    onRepoBuildStateAfter: setRepoBuildStateAfter,
    onVerificationRecord: setVerificationRecord,
    continueOverrideCount: checkpoint.continueOverrideCount,
  });
}
