/**
 * Resume an approval-required checkpoint after host approve/deny.
 */
import type { ToolApprovalToken } from "../../tool-runtime";

import { AgentEngineError } from "../contracts";
import type { AgentRunResult } from "../contracts";
import { ReadLedger } from "../internal/ReadLedger";
import { ToolCallCache } from "../internal/ToolCallCache";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  executeOneTool,
} from "./executeTool";
import { resumeV8ToolLoopFromCheckpoint } from "./resumeToolLoop";
import type { ResumeHandlerContext } from "./resumeHandlerTypes";

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
