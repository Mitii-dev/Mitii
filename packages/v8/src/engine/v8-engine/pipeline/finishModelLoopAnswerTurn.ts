import type { ModelMessage } from "../../../modules/model-gateway";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";

import type { AgentReasonCode } from "../contracts";
import type { LoopFileReadTracker } from "../actions";
import { isClearMutationBlocker } from "../actions/isClearMutationBlocker";
import { preserveSubstantiveAssistantAnswer } from "../actions/preserveSubstantiveAssistantAnswer";
import {
  buildIncompleteAnswerRecoveryMessage,
  compactRecoveredAssistantContent,
  synthesizeFallbackAnswer,
} from "../actions/isIncompleteAssistantTurn";
import { resolveLoopTurnOutcome } from "../actions/resolveLoopTurnOutcome";
import {
  readonlyThrashPartialAnswer,
  unfulfilledExecuteNudgeMessage,
} from "../modules/mutation-nudge";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { ToolLoopOutcome } from "./types";

export type FinishModelLoopAnswerTurnResult = {
  answer: string;
  incompleteAnswerRecoveries: number;
  unfulfilledExecuteRecoveries: number;
} & ({ kind: "continue" } | { kind: "done"; outcome: ToolLoopOutcome });

/**
 * Handle a model turn with no tool calls: preserve answer, mutation nudges,
 * incomplete-narration recovery, or complete the loop.
 */
export function finishModelLoopAnswerTurn(params: {
  priorAnswer: string;
  turnContent: string;
  finishReason: string | undefined;
  truncated: boolean;
  messages: ModelMessage[];
  decision: ExecutionDecision;
  understanding: RequestUnderstandingResult | undefined;
  mutationNeeded: boolean;
  changedFiles: string[];
  gitWriteSucceeded: boolean;
  mutationCheckpointIds: string[];
  toolCache: ToolCallCache;
  planDraftedThisRun: boolean;
  loopFileReads: LoopFileReadTracker;
  vcsHistoryRewrite: boolean;
  truncationRecoveriesUsed: number;
  incompleteAnswerRecoveries: number;
  unfulfilledExecuteRecoveries: number;
  maxIncompleteAnswerRecoveries: number;
  maxUnfulfilledExecuteRecoveries: number;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  offerContinue: (
    wallReason: "unfulfilled_execute",
    partialAnswer: string,
  ) => ToolLoopOutcome;
}): FinishModelLoopAnswerTurnResult {
  let answer = preserveSubstantiveAssistantAnswer(
    params.priorAnswer,
    params.turnContent,
  );
  params.messages.push({ role: "assistant", content: params.turnContent });

  let incompleteAnswerRecoveries = params.incompleteAnswerRecoveries;
  let unfulfilledExecuteRecoveries = params.unfulfilledExecuteRecoveries;

  const mutationStillNeeded =
    params.mutationNeeded &&
    params.changedFiles.length === 0 &&
    !params.gitWriteSucceeded;

  if (mutationStillNeeded) {
    if (
      isClearMutationBlocker(params.turnContent) ||
      isClearMutationBlocker(answer)
    ) {
      params.reasonCodes.push("answer_produced");
      return {
        kind: "done",
        answer,
        incompleteAnswerRecoveries,
        unfulfilledExecuteRecoveries,
        outcome: {
          kind: "completed",
          answer,
          changedFiles: params.changedFiles,
          mutationCheckpointIds: params.mutationCheckpointIds,
          messages: params.messages,
          toolCache: params.toolCache,
          decision: params.decision,
        },
      };
    }
    unfulfilledExecuteRecoveries += 1;
    if (
      unfulfilledExecuteRecoveries <= params.maxUnfulfilledExecuteRecoveries
    ) {
      params.warnings.push("Unfulfilled execute: nudging for apply_patch.");
      params.messages.push({
        role: "user",
        content: unfulfilledExecuteNudgeMessage({
          vcsHistoryRewrite: params.vcsHistoryRewrite,
        }),
      });
      return {
        kind: "continue",
        answer,
        incompleteAnswerRecoveries,
        unfulfilledExecuteRecoveries,
      };
    }
    return {
      kind: "done",
      answer,
      incompleteAnswerRecoveries,
      unfulfilledExecuteRecoveries,
      outcome: params.offerContinue(
        "unfulfilled_execute",
        answer.trim().length > 0
          ? answer
          : readonlyThrashPartialAnswer({
              hasPlan: params.planDraftedThisRun,
              fileReadCalls: params.loopFileReads.calls,
            }),
      ),
    };
  }

  const turnOutcome = resolveLoopTurnOutcome({
    route: params.decision.route,
    maximumWorkspaceEffect: params.decision.toolGrant.maximumWorkspaceEffect,
    primaryTaskIntent:
      params.understanding?.intent.classification.primaryTaskIntent ??
      "question",
    toolCallCount: 0,
    changedFileCount: params.changedFiles.length,
    content: params.turnContent,
    finishReason: params.finishReason,
    truncated: params.truncated,
    mutationBudget: params.decision.toolGrant.mutationBudget,
    reasonCodes: params.decision.reasonCodes,
    allowedTools: params.decision.toolGrant.allowedTools,
    fileReadCalls: params.loopFileReads.calls,
    recoveries: {
      truncation: params.truncationRecoveriesUsed,
      incompleteAnswer: incompleteAnswerRecoveries,
      unfulfilledExecute: unfulfilledExecuteRecoveries,
    },
    thresholds: {
      maxIncompleteAnswerRecoveries: params.maxIncompleteAnswerRecoveries,
      maxUnfulfilledExecuteRecoveries: params.maxUnfulfilledExecuteRecoveries,
    },
  });

  if (turnOutcome.disposition === "recover_incomplete_narration") {
    incompleteAnswerRecoveries += 1;
    params.reasonCodes.push(turnOutcome.reasonCode);
    params.messages.pop();
    params.messages.push({
      role: "assistant",
      content:
        compactRecoveredAssistantContent(params.turnContent) ||
        params.turnContent ||
        "(empty turn)",
    });
    params.messages.push({
      role: "user",
      content:
        turnOutcome.recoveryMessage ??
        buildIncompleteAnswerRecoveryMessage({
          changedFiles: params.changedFiles,
          emptyTurn: params.turnContent.trim().length === 0,
        }),
    });
    params.warnings.push(
      params.turnContent.trim().length === 0
        ? "Empty assistant turn; requesting a real answer or tool call."
        : "Incomplete narration; requesting a final user-facing answer.",
    );
    return {
      kind: "continue",
      answer,
      incompleteAnswerRecoveries,
      unfulfilledExecuteRecoveries,
    };
  }

  if (turnOutcome.reasonCode === "incomplete_answer_fallback") {
    answer = synthesizeFallbackAnswer({
      priorAnswer: params.turnContent,
      changedFiles: params.changedFiles,
    });
    params.reasonCodes.push("incomplete_answer_fallback");
  } else if (answer.trim().length > 0) {
    params.reasonCodes.push("answer_produced");
  }

  if (params.changedFiles.length > 0 || params.gitWriteSucceeded) {
    params.reasonCodes.push("mutation_applied");
  }

  return {
    kind: "done",
    answer,
    incompleteAnswerRecoveries,
    unfulfilledExecuteRecoveries,
    outcome: {
      kind: "completed",
      answer,
      changedFiles: params.changedFiles,
      mutationCheckpointIds: params.mutationCheckpointIds,
      messages: params.messages,
      toolCache: params.toolCache,
      decision: params.decision,
    },
  };
}
