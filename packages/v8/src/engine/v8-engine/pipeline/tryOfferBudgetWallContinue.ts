import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { TaskList } from "../../../modules/task-list";

import {
  buildBudgetWallRationale,
  shouldOfferBudgetWallContinue,
  type BudgetWallReason,
} from "../actions/buildStallContinueRationale";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { ToolLoopOutcome } from "./types";

/**
 * Build a `continue_required` loop outcome when the user still has Continue
 * overrides left. Returns undefined so callers can fall back to terminal fail.
 */
export function tryOfferBudgetWallContinue(params: {
  wallReason: BudgetWallReason;
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  answer: string;
  decision: ExecutionDecision;
  continueOverrideCount: number;
  maxContinueOverrides: number;
  taskList?: TaskList;
  mutationRequired?: boolean;
  fileReadCalls?: number;
  uniqueFilePathsTouched?: number;
  budgetMessage?: string;
}): Extract<ToolLoopOutcome, { kind: "continue_required" }> | undefined {
  if (
    !shouldOfferBudgetWallContinue({
      continueOverrideCount: params.continueOverrideCount,
      maxContinueOverrides: params.maxContinueOverrides,
    })
  ) {
    return undefined;
  }

  return {
    kind: "continue_required",
    messages: params.messages,
    toolCache: params.toolCache,
    rationale: buildBudgetWallRationale({
      reason: params.wallReason,
      changedFiles: params.changedFiles,
      taskList: params.taskList,
      answer: params.answer,
      mutationRequired: params.mutationRequired,
      fileReadCalls: params.fileReadCalls,
      uniqueFilePathsTouched: params.uniqueFilePathsTouched,
      budgetMessage: params.budgetMessage,
    }),
    changedFiles: params.changedFiles,
    mutationCheckpointIds: params.mutationCheckpointIds,
    answer: params.answer,
    decision: params.decision,
    continueOverrideCount: params.continueOverrideCount,
    wallReason: params.wallReason,
  };
}
