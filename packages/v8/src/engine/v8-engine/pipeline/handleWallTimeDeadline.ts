import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";

import type { AgentReasonCode } from "../contracts";
import { synthesizeFallbackAnswer } from "../actions/isIncompleteAssistantTurn";
import {
  buildWallTimeWrapUpNudge,
  decideWallTimeDeadline,
} from "../actions/resolveWallTimeDeadline";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { OfferContinueFn } from "./createOfferContinue";
import type { ToolLoopOutcome } from "./types";

export type WallTimeDeadlineResult =
  | { kind: "continue"; wallTimeNudged: boolean }
  | { kind: "done"; outcome: ToolLoopOutcome; wallTimeNudged: boolean };

/**
 * Apply wall-time finalize / wrap-up nudge / budget-exhausted Continue before
 * starting a model call.
 */
export function handleWallTimeDeadline(params: {
  budget: RunBudgetTracker;
  mutationApplied: boolean;
  mutationRequired: boolean;
  wallTimeNudged: boolean;
  answer: string;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  decision: ExecutionDecision;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  offerContinue: OfferContinueFn;
}): WallTimeDeadlineResult {
  let wallTimeNudged = params.wallTimeNudged;
  const wallDeadline = decideWallTimeDeadline({
    remainingMs: params.budget.remainingWallMs(),
    maxWallTimeMs: params.budget.maxWallTimeMs(),
    mutationApplied: params.mutationApplied,
    mutationRequired: params.mutationRequired,
    alreadyNudged: wallTimeNudged,
  });

  if (wallDeadline === "finalize_after_mutation") {
    params.reasonCodes.push(
      "wall_time_finalize_after_mutation",
      "mutation_applied",
    );
    params.warnings.push(
      "Run wall-time budget nearly exhausted; finalizing after the applied edit so verification can run.",
    );
    let answer = params.answer;
    if (answer.trim().length === 0) {
      answer = synthesizeFallbackAnswer({
        priorAnswer: "",
        changedFiles: params.changedFiles,
      });
    }
    return {
      kind: "done",
      wallTimeNudged,
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

  if (wallDeadline === "wrap_up_nudge") {
    wallTimeNudged = true;
    params.reasonCodes.push("wall_time_wrap_up_nudge");
    params.messages.push({
      role: "user",
      content: buildWallTimeWrapUpNudge(params.budget.remainingWallMs()),
    });
  }

  if (!params.budget.canStartModelCall()) {
    // Soft ceiling hit. If soft already equals hard, this is terminal.
    if (!params.budget.canExtendModelSoft()) {
      params.reasonCodes.push("budget_exhausted");
      return {
        kind: "done",
        wallTimeNudged,
        outcome: {
          kind: "budget_exhausted",
          answer: params.answer || undefined,
          message:
            "Hard model-call safety ceiling reached; cannot extend further.",
          changedFiles: params.changedFiles,
          mutationCheckpointIds: params.mutationCheckpointIds,
        },
      };
    }
    // Soft checkpoint — offer Continue to raise soft toward hard.
    params.reasonCodes.push("run_budget_soft_wall");
    return {
      kind: "done",
      wallTimeNudged,
      outcome: params.offerContinue(
        "budget_exhausted",
        params.answer || "Model call soft budget reached — Continue to extend.",
      ),
    };
  }

  return { kind: "continue", wallTimeNudged };
}
