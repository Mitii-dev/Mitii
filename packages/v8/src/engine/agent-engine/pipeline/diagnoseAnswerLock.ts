import type { ModelToolCall, ModelToolDefinition } from "../../../modules/model-gateway";

/**
 * Diagnose / repository_answer thrash (BillBuddy 23:34): model already has
 * tsc errors but oscillates on read_diagnostics instead of answering.
 */

export function primaryToolNameIfUniform(
  toolCalls: readonly ModelToolCall[],
): string | undefined {
  if (toolCalls.length === 0) return undefined;
  const name = toolCalls[0]?.name;
  if (!name) return undefined;
  return toolCalls.every((call) => call.name === name) ? name : undefined;
}

export function updateRepeatedReadonlyToolTurns(params: {
  previousToolName: string | undefined;
  previousCount: number;
  turnToolName: string | undefined;
}): { toolName: string | undefined; count: number } {
  if (!params.turnToolName) {
    return { toolName: undefined, count: 0 };
  }
  if (params.turnToolName === params.previousToolName) {
    return {
      toolName: params.turnToolName,
      count: params.previousCount + 1,
    };
  }
  return { toolName: params.turnToolName, count: 1 };
}

export function shouldNudgeDiagnoseAnswer(params: {
  mutationRequired: boolean;
  consecutiveSameToolTurns: number;
  maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: number;
  diagnoseAnswerNudges: number;
  maxDiagnoseAnswerNudges: number;
}): boolean {
  if (params.mutationRequired) return false;
  if (
    params.consecutiveSameToolTurns <
    params.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge
  ) {
    return false;
  }
  return params.diagnoseAnswerNudges < params.maxDiagnoseAnswerNudges;
}

export function shouldLockDiagnoseAnswer(params: {
  mutationRequired: boolean;
  consecutiveSameToolTurns: number;
  maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: number;
  diagnoseAnswerNudges: number;
  maxDiagnoseAnswerNudges: number;
}): boolean {
  if (params.mutationRequired) return false;
  if (
    params.consecutiveSameToolTurns <
    params.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge
  ) {
    return false;
  }
  // After the nudge budget is spent, strip tools on the next model turn.
  return params.diagnoseAnswerNudges >= params.maxDiagnoseAnswerNudges;
}

export const DIAGNOSE_ANSWER_NUDGE_MESSAGE =
  "You already have enough evidence from prior tool results (including any typecheck/command output). Answer the user now with concrete findings. Do not call the same diagnostic/read tool again. If IDE diagnostics were empty, rely on command output you already ran.";

/** Strip all tools so the model must produce a final text answer. */
export function filterToolsForAnswerLock(
  tools: readonly ModelToolDefinition[] | undefined,
): ModelToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return tools as ModelToolDefinition[] | undefined;
  }
  return [];
}

/**
 * Model-request fields for an answer-only turn. Always pairs empty tools with
 * toolChoice "none" — the gateway rejects any other choice when tools is empty.
 */
export function answerLockModelRequestFields(
  tools: readonly ModelToolDefinition[] | undefined,
): {
  tools: ModelToolDefinition[] | undefined;
  toolChoice: "none";
} {
  return {
    tools: filterToolsForAnswerLock(tools),
    toolChoice: "none",
  };
}
