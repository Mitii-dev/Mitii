import type { PlanArtifact } from "../../../modules/planning";
import { formatPlanAsAnswer } from "../../../modules/planning";
import type { ToolApprovalToken } from "../../tool-runtime";

import {
  amendMessageWithClarification,
  resolveClarificationAnswer,
} from "../actions";
import { formatClarificationAnswerFromPatch } from "../../../modules/request-understanding";
import { AgentEngineError } from "../contracts";
import type { AgentEngineStartInput, AgentRunResult } from "../contracts";
import { ReadLedger } from "../internal/ReadLedger";
import { ToolCallCache } from "../internal/ToolCallCache";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  executeOneTool,
} from "./executeTool";
import { executeV8Start } from "./executeStart";
import { planApprovalResumeStartParams } from "./startReuse";
import { resumeV8ToolLoopFromCheckpoint } from "./resumeToolLoop";
import type { ResumeHandlerContext } from "./resumeHandlerTypes";

export type { ResumeFinish, ResumeHandlerContext } from "./resumeHandlerTypes";
export { handleGrantExpansionResume } from "./executeResumeGrantExpansion";
export { handleContinueResume } from "./executeResumeContinue";

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
    ...planApprovalResumeStartParams({
      checkpoint,
      decision: ctx.decision,
      plan: nextPlan,
      edited: input.planDecision.decision === "edited",
    }),
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
