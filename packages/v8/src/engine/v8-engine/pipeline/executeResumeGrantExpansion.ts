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
