/**
 * After-settle diagnose-answer nudge / lock (non-mutation paths).
 */
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import type { AgentReasonCode } from "../contracts";
import {
  DIAGNOSE_ANSWER_NUDGE_MESSAGE,
  primaryToolNameIfUniform,
  shouldLockDiagnoseAnswer,
  shouldNudgeDiagnoseAnswer,
  updateRepeatedReadonlyToolTurns,
} from "../modules/diagnose-answer";
import type { SettleToolsResult } from "./settleTools";
import type { AfterToolSettleState } from "./advanceAfterToolSettleTypes";

export function applyAfterToolSettleDiagnoseRails(params: {
  settled: Extract<SettleToolsResult, { kind: "continue" }>;
  toolCalls: readonly ModelToolCall[];
  messages: ModelMessage[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  mutationNeeded: boolean;
  budgetCanStartModelCall: boolean;
  thresholds: {
    maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: number;
    maxDiagnoseAnswerNudges: number;
  };
  state: AfterToolSettleState;
}): void {
  const {
    settled,
    toolCalls,
    messages,
    reasonCodes,
    warnings,
    mutationNeeded,
    budgetCanStartModelCall,
    thresholds,
    state,
  } = params;

  if (!mutationNeeded && settled.stats.readonlyOnly) {
    const uniform = primaryToolNameIfUniform(toolCalls);
    const next = updateRepeatedReadonlyToolTurns({
      previousToolName: state.lastUniformToolName,
      previousCount: state.consecutiveSameToolTurns,
      turnToolName: uniform,
    });
    state.lastUniformToolName = next.toolName;
    state.consecutiveSameToolTurns = next.count;

    if (
      shouldNudgeDiagnoseAnswer({
        mutationRequired: false,
        consecutiveSameToolTurns: state.consecutiveSameToolTurns,
        maxRepeatedReadonlyToolTurnsBeforeAnswerNudge:
          thresholds.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge,
        diagnoseAnswerNudges: state.diagnoseAnswerNudges,
        maxDiagnoseAnswerNudges: thresholds.maxDiagnoseAnswerNudges,
      }) &&
      budgetCanStartModelCall
    ) {
      state.diagnoseAnswerNudges += 1;
      reasonCodes.push("incomplete_answer_recovered");
      messages.push({
        role: "user",
        content: DIAGNOSE_ANSWER_NUDGE_MESSAGE,
      });
      warnings.push(
        `Repeated ${uniform ?? "tool"} turns without an answer; requesting a final response.`,
      );
    } else if (
      shouldLockDiagnoseAnswer({
        mutationRequired: false,
        consecutiveSameToolTurns: state.consecutiveSameToolTurns,
        maxRepeatedReadonlyToolTurnsBeforeAnswerNudge:
          thresholds.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge,
        diagnoseAnswerNudges: state.diagnoseAnswerNudges,
        maxDiagnoseAnswerNudges: thresholds.maxDiagnoseAnswerNudges,
      })
    ) {
      state.awaitingAnswerOnly = true;
      reasonCodes.push("incomplete_answer_recovered");
      messages.push({
        role: "user",
        content: DIAGNOSE_ANSWER_NUDGE_MESSAGE,
      });
      warnings.push(
        "Stripped tools after repeated identical diagnostic turns; next turn must answer.",
      );
    }
    return;
  }

  if (!mutationNeeded) {
    state.consecutiveSameToolTurns = 0;
    state.lastUniformToolName = undefined;
  }
}
