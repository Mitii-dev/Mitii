import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type {
  ModelMessage,
} from "../../../modules/model-gateway";
import type {
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";

import {
  buildIncompleteAnswerRecoveryMessage,
  buildUnfulfilledExecuteRecoveryMessage,
  compactRecoveredAssistantContent,
  isEmptyAssistantTurn,
  isTransitionalAssistantAnswer,
  resolveLoopTurnOutcome,
  shouldRecoverIncompleteAssistantTurn,
  synthesizeFallbackAnswer,
} from "../actions";
import type { AgentReasonCode } from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { AgentEngineThresholds } from "../actions/resolveAgentEngineThresholds";

import type { AgentEngineRuntime } from "./runtime";
import { appendTextContinuation } from "./appendTextContinuation";
import type { ModelLoopSession } from "./modelLoopSession";
import type { ModelLoopStepResult } from "./modelLoopStep";

export function handleNoToolModelTurn(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  session: ModelLoopSession;
  decision: ExecutionDecision;
  grant: ExecutionDecision["toolGrant"];
  understanding: RequestUnderstandingResult | undefined;
  turnContent: string;
  finishReason: string | undefined;
  truncated: boolean;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  thresholds: AgentEngineThresholds;
}): ModelLoopStepResult {
  const {
    runtime,
    runId,
    bus,
    session,
    decision,
    grant,
    understanding,
    turnContent,
    finishReason,
    truncated,
    changedFiles,
    mutationCheckpointIds,
    messages,
    toolCache,
    budget,
    reasonCodes,
    warnings,
    thresholds,
  } = params;
  let answer = session.answer;
  let pendingTextContinuation = session.pendingTextContinuation;
  let incompleteAnswerRecoveries = session.incompleteAnswerRecoveries;
  let unfulfilledExecuteRecoveries = session.unfulfilledExecuteRecoveries;
  const successfulVerificationAfterMutation =
    session.successfulVerificationAfterMutation;
  const truncationRecoveries = session.truncationRecoveries;

    if (turnContent.length > 0) {
      const turnAnswer = truncated
        ? `${turnContent}\n\n…(output truncated — token limit reached)`
        : turnContent;
      if (pendingTextContinuation.length > 0) {
        answer = appendTextContinuation(
          pendingTextContinuation,
          turnAnswer,
        );
        if (!truncated) {
          pendingTextContinuation = "";
        }
      } else {
        answer = turnAnswer;
      }
    }

    const incompleteAssistantTurn = shouldRecoverIncompleteAssistantTurn({
      content: turnContent,
      toolCallCount: 0,
      changedFileCount: changedFiles.length,
      fileReadCalls: budget.snapshot().fileReadCalls,
    });
    const loopOutcome = resolveLoopTurnOutcome({
      route: decision.route,
      maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
      primaryTaskIntent:
        understanding?.intent.classification.primaryTaskIntent ?? "",
      toolCallCount: 0,
      changedFileCount: changedFiles.length,
      content: turnContent,
      finishReason: finishReason,
      truncated,
      mutationBudget: grant.mutationBudget,
      reasonCodes: decision.reasonCodes,
      fileReadCalls: budget.snapshot().fileReadCalls,
      recoveries: {
        truncation: truncationRecoveries,
        incompleteAnswer: incompleteAnswerRecoveries,
        unfulfilledExecute: unfulfilledExecuteRecoveries,
      },
      thresholds,
    });
    if (
      incompleteAssistantTurn &&
      successfulVerificationAfterMutation &&
      changedFiles.length > 0
    ) {
      answer = synthesizeFallbackAnswer({
        priorAnswer: answer || turnContent,
        changedFiles,
      });
      reasonCodes.push("incomplete_answer_fallback");
      session.answer = answer;
      session.pendingTextContinuation = pendingTextContinuation;
      session.incompleteAnswerRecoveries = incompleteAnswerRecoveries;
      session.unfulfilledExecuteRecoveries = unfulfilledExecuteRecoveries;
      return { kind: "return", outcome: {
        kind: "completed",
        answer,
        changedFiles,
        mutationCheckpointIds,
        messages,
        toolCache,
        decision,
      } };
    }

    if (
      loopOutcome.disposition === "recover_unfulfilled_execute" &&
      unfulfilledExecuteRecoveries <
        thresholds.maxUnfulfilledExecuteRecoveries &&
      budget.canStartModelCall()
    ) {
      unfulfilledExecuteRecoveries += 1;
      reasonCodes.push("unfulfilled_execute_recovered");
      if (turnContent.trim().length > 0) {
        messages.push({
          role: "assistant",
          content: compactRecoveredAssistantContent(turnContent, thresholds.maxRecoveredAnalysisChars),
        });
      }
      messages.push({
        role: "user",
        content:
          loopOutcome.recoveryMessage ??
          buildUnfulfilledExecuteRecoveryMessage(grant.mutationBudget),
      });
      warnings.push(
        "Execute route produced analysis with no workspace edits; requesting apply_patch.",
      );
      runtime.emit(bus, {
        type: "warning",
        runId,
        message:
          "Model ended on a diagnosis without apply_patch; continuing so the fix can be applied.",
        at: runtime.isoNow(),
      });
      session.answer = answer;
        session.pendingTextContinuation = pendingTextContinuation;
        session.incompleteAnswerRecoveries = incompleteAnswerRecoveries;
        session.unfulfilledExecuteRecoveries = unfulfilledExecuteRecoveries;
        return { kind: "continue" };
    }

    if (loopOutcome.reasonCode === "unfulfilled_execute_exhausted") {
      reasonCodes.push("unfulfilled_execute_exhausted");
      session.answer = answer;
      session.pendingTextContinuation = pendingTextContinuation;
      session.incompleteAnswerRecoveries = incompleteAnswerRecoveries;
      session.unfulfilledExecuteRecoveries = unfulfilledExecuteRecoveries;
      return { kind: "return", outcome: {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["unfulfilled_execute_exhausted"],
        error: {
          code: "no_mutation_performed",
          message:
            "The model exhausted the recovery budget without applying workspace edits.",
        },
      } };
    } else if (
      (incompleteAssistantTurn ||
        loopOutcome.disposition === "recover_incomplete_narration") &&
      incompleteAnswerRecoveries <
        thresholds.maxIncompleteAnswerRecoveries &&
      budget.canStartModelCall()
    ) {
      incompleteAnswerRecoveries += 1;
      reasonCodes.push("incomplete_answer_recovered");
      const emptyTurn = isEmptyAssistantTurn({
        content: turnContent,
        toolCallCount: 0,
      });
      const recoveryContent =
        loopOutcome.recoveryMessage ??
        buildIncompleteAnswerRecoveryMessage({
          changedFiles,
          emptyTurn,
        });
      if (turnContent.trim().length > 0) {
        messages.push({
          role: "assistant",
          content: compactRecoveredAssistantContent(turnContent, thresholds.maxRecoveredAnalysisChars),
        });
      }
      messages.push({
        role: "user",
        content: recoveryContent,
      });
      warnings.push(
        emptyTurn
          ? "Empty model turn recovered; requesting a final answer or next tool call."
          : "Transitional narration recovered; requesting a final answer or next tool call.",
      );
      runtime.emit(bus, {
        type: "warning",
        runId,
        message: emptyTurn
          ? "Model returned an empty turn; continuing for a complete answer."
          : "Model ended on transitional narration; continuing for a complete answer.",
        at: runtime.isoNow(),
      });
      session.answer = answer;
        session.pendingTextContinuation = pendingTextContinuation;
        session.incompleteAnswerRecoveries = incompleteAnswerRecoveries;
        session.unfulfilledExecuteRecoveries = unfulfilledExecuteRecoveries;
        return { kind: "continue" };
    }

    if (
      shouldRecoverIncompleteAssistantTurn({
        content: answer,
        toolCallCount: 0,
        changedFileCount: changedFiles.length,
        fileReadCalls: budget.snapshot().fileReadCalls,
      }) ||
      (changedFiles.length > 0 &&
        (answer.trim().length === 0 ||
          isTransitionalAssistantAnswer(answer)))
    ) {
      answer = synthesizeFallbackAnswer({
        priorAnswer: answer,
        changedFiles,
      });
      reasonCodes.push("incomplete_answer_fallback");
    }

    session.answer = answer;
    session.pendingTextContinuation = pendingTextContinuation;
    session.incompleteAnswerRecoveries = incompleteAnswerRecoveries;
    session.unfulfilledExecuteRecoveries = unfulfilledExecuteRecoveries;
    return {
      kind: "return",
      outcome: {
        kind: "completed",
        answer,
        changedFiles,
        mutationCheckpointIds,
        messages,
        toolCache,
        decision,
      },
    };
}
