import { MUTATION_TASK_INTENTS } from "../../../modules/decision-policy";
import type {
  ExecutionRoute,
  MutationBudget,
  ToolGrant,
} from "../../../modules/decision-policy";

import { AGENT_ENGINE_THRESHOLDS } from "../policy";
import type { AgentReasonCode } from "../contracts";
import type { AgentEngineThresholds } from "./resolveAgentEngineThresholds";

import { isClearMutationBlocker } from "./isClearMutationBlocker";
import { shouldRecoverIncompleteAssistantTurn } from "./isIncompleteAssistantTurn";

export const LOOP_TURN_DISPOSITIONS = [
  "execute_tools",
  "complete_answer",
  "recover_unfulfilled_execute",
  "recover_incomplete_narration",
  "recover_truncated_tools",
  "recover_truncated_text",
] as const;

export type LoopTurnDisposition = (typeof LOOP_TURN_DISPOSITIONS)[number];

const MUTATION_INTENT_SET = new Set<string>(MUTATION_TASK_INTENTS);

export interface ResolveLoopTurnOutcomeInput {
  route: ExecutionRoute;
  maximumWorkspaceEffect: ToolGrant["maximumWorkspaceEffect"];
  primaryTaskIntent: string;
  toolCallCount: number;
  changedFileCount: number;
  content: string;
  finishReason?: string;
  truncated: boolean;
  mutationBudget?: MutationBudget;
  recoveries: {
    truncation: number;
    incompleteAnswer: number;
    unfulfilledExecute: number;
  };
  thresholds?: Pick<
    AgentEngineThresholds,
    "maxIncompleteAnswerRecoveries" | "maxUnfulfilledExecuteRecoveries"
  >;
}

export interface ResolveLoopTurnOutcome {
  disposition: LoopTurnDisposition;
  reasonCode: AgentReasonCode;
  recoveryMessage?: string;
}

/**
 * Decide whether a text-only (or truncated) model turn may complete the loop.
 * Execute + write + mutation intent with zero files changed is not success.
 */
export function resolveLoopTurnOutcome(
  input: ResolveLoopTurnOutcomeInput,
): ResolveLoopTurnOutcome {
  if (input.toolCallCount > 0) {
    return {
      disposition: "execute_tools",
      reasonCode: "tools_executed",
    };
  }

  const unfulfilled = isUnfulfilledExecute(input);
  const truncated = input.truncated || input.finishReason === "length";

  if (truncated) {
    if (unfulfilled) {
      return recoverOrExhaustUnfulfilled(input, "output_truncated");
    }
    if (input.content.trim().length > 0) {
      return {
        disposition: "recover_truncated_text",
        reasonCode: "output_truncated",
      };
    }
  }

  if (unfulfilled) {
    return recoverOrExhaustUnfulfilled(input);
  }

  const incomplete = shouldRecoverIncompleteAssistantTurn({
    content: input.content,
    toolCallCount: 0,
    changedFileCount: input.changedFileCount,
  });
  if (incomplete) {
    const maxIncomplete =
      input.thresholds?.maxIncompleteAnswerRecoveries ??
      AGENT_ENGINE_THRESHOLDS.maxIncompleteAnswerRecoveries;
    if (input.recoveries.incompleteAnswer < maxIncomplete) {
      return {
        disposition: "recover_incomplete_narration",
        reasonCode: "incomplete_answer_recovered",
      };
    }
    return {
      disposition: "complete_answer",
      reasonCode: "incomplete_answer_fallback",
    };
  }

  return {
    disposition: "complete_answer",
    reasonCode: "answer_produced",
  };
}

export function isUnfulfilledExecute(input: {
  route: ExecutionRoute;
  maximumWorkspaceEffect: ToolGrant["maximumWorkspaceEffect"];
  primaryTaskIntent: string;
  toolCallCount: number;
  changedFileCount: number;
  content: string;
}): boolean {
  if (input.toolCallCount > 0) {
    return false;
  }
  if (input.route !== "execute") {
    return false;
  }
  if (input.maximumWorkspaceEffect !== "write") {
    return false;
  }
  if (input.changedFileCount > 0) {
    return false;
  }
  if (!MUTATION_INTENT_SET.has(input.primaryTaskIntent)) {
    return false;
  }
  // Recovery copy invites "stop with a clear blocker" when a workspace edit
  // cannot proceed (missing config, credentials, external dependency, etc.).
  if (isClearMutationBlocker(input.content)) {
    return false;
  }
  // Any other text-only stop on execute+write+mutation is unfulfilled: the
  // model described work instead of calling apply_patch.
  return true;
}

export function requiresMutationForExecute(input: {
  route: ExecutionRoute;
  maximumWorkspaceEffect: ToolGrant["maximumWorkspaceEffect"];
  primaryTaskIntent?: string;
  reasonCodes?: readonly string[];
}): boolean {
  if (input.route !== "execute") {
    return false;
  }
  if (input.maximumWorkspaceEffect !== "write") {
    return false;
  }
  if (input.reasonCodes?.includes("mutation_execute")) {
    return true;
  }
  return input.primaryTaskIntent
    ? MUTATION_INTENT_SET.has(input.primaryTaskIntent)
    : false;
}

export function buildUnfulfilledExecuteRecoveryMessage(
  _mutationBudget?: MutationBudget,
): string {
  return [
    "You described the fix but did not call apply_patch.",
    "Do not repeat the diagnosis or write a report.",
    "Call apply_patch now for the next batch. Use the live working-set mutation budget and compiler/preflight sections.",
    "If a file is still unknown, read it — then patch. Do not end this turn with analysis only.",
  ].join("\n");
}

function recoverOrExhaustUnfulfilled(
  input: ResolveLoopTurnOutcomeInput,
  truncatedReason?: AgentReasonCode,
): ResolveLoopTurnOutcome {
  const maxUnfulfilled =
    input.thresholds?.maxUnfulfilledExecuteRecoveries ??
    AGENT_ENGINE_THRESHOLDS.maxUnfulfilledExecuteRecoveries;
  if (input.recoveries.unfulfilledExecute < maxUnfulfilled) {
    return {
      disposition: "recover_unfulfilled_execute",
      reasonCode: truncatedReason ?? "unfulfilled_execute_recovered",
      recoveryMessage: buildUnfulfilledExecuteRecoveryMessage(
        input.mutationBudget,
      ),
    };
  }
  return {
    disposition: "complete_answer",
    reasonCode: "unfulfilled_execute_exhausted",
    recoveryMessage: buildUnfulfilledExecuteRecoveryMessage(
      input.mutationBudget,
    ),
  };
}
