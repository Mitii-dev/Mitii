import {
  buildBudgetWallResetMessage,
  buildPreflightDiagnosticRepairInstruction,
  resolveLoopPolicyThresholds,
} from "../actions";
import type { BudgetWallReason } from "../actions/buildStallContinueRationale";
import { AgentEngineError } from "../contracts";
import type { AgentRunResult } from "../contracts";
import { RunBudgetTracker } from "../internal/RunBudget";
import { commitMutations } from "./verification";
import { resumeV8ToolLoopFromCheckpoint } from "./resumeToolLoop";
import type { ResumeHandlerContext } from "./resumeHandlerTypes";

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
    const bumpFloor = resolveLoopPolicyThresholds({
      contextWindowTokens: windowPolicy.contextWindowTokens,
      overrides: startInput.loopPolicy?.thresholds,
    }).thresholds.continueBudgetModelCallBump;
    // Soft slice from window policy (e.g. 64). Each Continue adds another
    // soft chunk toward the hard ceiling — not a tiny +4 bump.
    const softModel = windowPolicy.run.maxModelCalls;
    const hardModel =
      resumeBudget.hardMaxModelCalls ?? windowPolicy.run.hardMaxModelCalls;
    const softTool = windowPolicy.run.maxToolCalls;
    const hardTool =
      resumeBudget.hardMaxToolCalls ?? windowPolicy.run.hardMaxToolCalls;
    const modelSlice = Math.max(bumpFloor, softModel);
    const toolSlice = Math.max(bumpFloor, softTool);
    const nextModelSoft = Math.min(
      hardModel,
      softModel + modelSlice * nextOverrideCount,
    );
    const nextToolSoft = Math.min(
      hardTool,
      softTool + toolSlice * nextOverrideCount,
    );
    continueBudget = new RunBudgetTracker(
      {
        ...resumeBudget,
        maxModelCalls: nextModelSoft,
        hardMaxModelCalls: hardModel,
        maxToolCalls: nextToolSoft,
        hardMaxToolCalls: hardTool,
        maxLoopIterations: nextModelSoft,
        hardMaxLoopIterations: hardModel,
      },
      checkpoint.startedAtMs,
      checkpoint.usage,
      excludedWaitMs,
    );
    warnings.push(
      `Extended soft run budget to ${nextModelSoft} model / ${nextToolSoft} tool calls (hard ${hardModel}/${hardTool}) after Continue.`,
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
