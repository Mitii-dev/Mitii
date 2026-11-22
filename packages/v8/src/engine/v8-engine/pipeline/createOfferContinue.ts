import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { TaskList } from "../../../modules/task-list";

import type { AgentReasonCode } from "../contracts";
import type { ToolCallCache } from "../internal/ToolCallCache";
import { tryOfferBudgetWallContinue } from "./tryOfferBudgetWallContinue";
import type { ToolLoopOutcome } from "./types";

export type OfferContinueFn = (
  wallReason:
    | "exploration_stall"
    | "unfulfilled_execute"
    | "budget_exhausted"
    | "evidence_clarify"
    | "provider_unavailable",
  partialAnswer: string,
) => ToolLoopOutcome;

/**
 * Build the Continue / stall-cap helper used by the model/tool loop.
 * Captures live `decision` via getter so mid-loop grant narrowing is visible.
 */
export function createOfferContinue(params: {
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  getDecision: () => ExecutionDecision;
  continueOverrideCount: number;
  maxContinueOverrides: number;
  getTaskList: () => TaskList | undefined;
  mutationRequired: boolean;
  reasonCodes: AgentReasonCode[];
}): OfferContinueFn {
  return (wallReason, partialAnswer) => {
    const offered = tryOfferBudgetWallContinue({
      wallReason,
      messages: params.messages,
      toolCache: params.toolCache,
      changedFiles: params.changedFiles,
      mutationCheckpointIds: params.mutationCheckpointIds,
      answer: partialAnswer,
      decision: params.getDecision(),
      continueOverrideCount: params.continueOverrideCount,
      maxContinueOverrides: params.maxContinueOverrides,
      taskList: params.getTaskList(),
      mutationRequired: params.mutationRequired,
    });
    if (offered) return offered;
    params.reasonCodes.push("stall_continue_override_capped");
    return {
      kind: "failed",
      answer: partialAnswer || undefined,
      extraReasons: [],
      error: {
        code:
          wallReason === "unfulfilled_execute"
            ? "no_mutation_performed"
            : "execution_failed",
        message:
          wallReason === "unfulfilled_execute"
            ? "Required mutation was not performed before the continue override cap."
            : "Tool loop exhausted without a recoverable Continue path.",
      },
    };
  };
}
