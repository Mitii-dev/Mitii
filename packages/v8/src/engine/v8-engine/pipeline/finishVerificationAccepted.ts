import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { TaskList } from "../../../modules/task-list";
import type { VerificationRecord } from "../../../modules/verification";
import {
  buildVerificationUserSummary,
  formatOptionalLeftoverOffer,
} from "../../../modules/verification";
import type { RepositoryStateReference } from "../../../modules/repository-state";

import {
  isPrematurePartialExecuteStop,
  isSyntheticCompletedEditsFallback,
  requiresMutationForExecute,
  selectUserFacingLoopAnswer,
} from "../actions";
import { isClearMutationBlocker } from "../actions/isClearMutationBlocker";
import { hasIncompleteChangeSurfaces } from "../internal/taskListRuntime";
import type {
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import type { AgentEngineRuntime } from "./runtime";

/**
 * Hard-terminal finish after Verification gate accept.
 *
 * Phase 1 reliability: ACCEPTED = STOP. Never Continue for incomplete
 * checklist (`shouldSuspendContinueAfterVerificationAccept` is false), never
 * reopen repair/discovery. Optional leftover pre-existing errors are appended
 * as an opt-in offer in the answer text only.
 */
export async function finishVerificationAccepted(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  pinnedState: RepositoryStateReference | undefined;
  reasonCodes: AgentReasonCode[];
  repairAttempts: number;
  loopAnswer: string | undefined;
  loopChangedFiles: readonly string[];
  record: VerificationRecord | undefined;
  remainingErrorCount: number;
  newErrorCount: number;
  decision: ExecutionDecision;
  understanding: RequestUnderstandingResult | undefined;
  taskList: TaskList | undefined;
  finish: (result: {
    status: "completed" | "failed";
    answer?: string;
    reasonCodes: AgentReasonCode[];
    error?: { code: string; message: string };
  }) => AgentRunResult;
}): Promise<AgentRunResult> {
  const {
    runtime,
    runId,
    pinnedState,
    reasonCodes,
    repairAttempts,
    loopAnswer,
    loopChangedFiles,
    record,
    remainingErrorCount: remaining,
    newErrorCount: newCount,
    decision,
    understanding,
    taskList,
    finish,
  } = params;

  if (repairAttempts > 0) {
    reasonCodes.push("verification_repair_succeeded");
  }
  reasonCodes.push("verification_accepted_terminal");

  let userAnswer = selectUserFacingLoopAnswer({
    loopAnswer,
    changedFiles: loopChangedFiles,
  });
  if (remaining > 0 && newCount === 0 && loopChangedFiles.length > 0 && record) {
    const leftover = buildVerificationUserSummary(record);
    if (leftover.trim()) {
      userAnswer = `${userAnswer.trim()}\n\n${leftover.trim()}`;
    }
  } else if (
    remaining > 0 &&
    newCount === 0 &&
    loopChangedFiles.length > 0
  ) {
    const leftover = formatOptionalLeftoverOffer({ remaining });
    if (leftover.trim()) {
      userAnswer = `${userAnswer.trim()}\n\n${leftover.trim()}`;
    }
  }

  const clearBlocker = isClearMutationBlocker(userAnswer);
  const mutationRequired = requiresMutationForExecute({
    route: decision.route,
    maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
    primaryTaskIntent:
      understanding?.intent.classification.primaryTaskIntent,
    reasonCodes: decision.reasonCodes,
    allowedTools: decision.toolGrant.allowedTools,
  });
  const checklistOpen = hasIncompleteChangeSurfaces(taskList);
  const incompleteExecute =
    !clearBlocker &&
    mutationRequired &&
    (loopChangedFiles.length === 0 ||
      (checklistOpen &&
        (isPrematurePartialExecuteStop({
          mutationRequired: true,
          hasIncompleteChangeSurfaces: true,
          content: userAnswer,
          changedFileCount: loopChangedFiles.length,
        }) ||
          isSyntheticCompletedEditsFallback(userAnswer))));

  await runtime.safeUnpin(runId, pinnedState);
  if (incompleteExecute) {
    reasonCodes.push("incomplete_execute", "answer_produced");
    return finish({
      status: "failed",
      answer: userAnswer,
      reasonCodes,
      error: {
        code: "incomplete_execute",
        message:
          "The execute run ended while change checklist surfaces were still open.",
      },
    });
  }
  const loopWasEmpty = !(loopAnswer?.trim());
  const usedStockFallback =
    loopWasEmpty &&
    /I stopped without a complete final answer/i.test(userAnswer);
  reasonCodes.push(
    usedStockFallback ? "incomplete_answer_fallback" : "answer_produced",
  );
  return finish({
    status: "completed",
    answer: userAnswer,
    reasonCodes,
  });
}
