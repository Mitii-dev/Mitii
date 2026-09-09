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
  /** Optional grant/decision reason codes (e.g. mutation_execute). */
  reasonCodes?: readonly string[];
  /** Cumulative file reads this run — used for repository_answer grounding. */
  fileReadCalls?: number;
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

  if (needsWorkspaceGroundingRecovery(input)) {
    const maxIncomplete =
      input.thresholds?.maxIncompleteAnswerRecoveries ??
      AGENT_ENGINE_THRESHOLDS.maxIncompleteAnswerRecoveries;
    if (input.recoveries.incompleteAnswer < maxIncomplete) {
      return {
        disposition: "recover_incomplete_narration",
        reasonCode: "incomplete_answer_recovered",
        recoveryMessage:
          "You claimed the workspace/files were unavailable, but this is a repository question. Call read_file, search_files, or glob_files now and answer from the file contents. Do not guess.",
      };
    }
  }

  const incomplete = shouldRecoverIncompleteAssistantTurn({
    content: input.content,
    toolCallCount: 0,
    changedFileCount: input.changedFileCount,
    fileReadCalls: input.fileReadCalls,
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
  reasonCodes?: readonly string[];
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
  if (!requiresMutationIntent(input.primaryTaskIntent, input.reasonCodes)) {
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

function requiresMutationIntent(
  primaryTaskIntent: string,
  reasonCodes?: readonly string[],
): boolean {
  if (MUTATION_INTENT_SET.has(primaryTaskIntent)) {
    return true;
  }
  // Docs create/update on execute+write still requires a patch even though
  // "docs" is also an answer taxonomy for explain-docs asks.
  if (primaryTaskIntent === "docs") {
    return true;
  }
  return reasonCodes?.includes("mutation_execute") === true;
}

/** Model claimed it cannot see the repo despite repository_answer/diagnose. */
export function claimsMissingWorkspaceContext(content: string): boolean {
  const text = content.trim();
  if (text.length < 24) {
    return false;
  }
  return (
    /\b(?:don'?t|do not|cannot|can'?t)\s+have\b[\s\S]{0,60}\b(?:repository|workspace|files?|context)\b/i.test(
      text,
    ) ||
    /\bno\s+(?:repository|workspace)\s+(?:files?|context|code)\b/i.test(text) ||
    /\b(?:can'?t|cannot)\s+identify\b/i.test(text) ||
    /\bwithout\s+(?:access to|any)\s+(?:the\s+)?(?:repository|workspace|files?|code)\b/i.test(
      text,
    )
  );
}

function needsWorkspaceGroundingRecovery(input: {
  route: ExecutionRoute;
  toolCallCount: number;
  fileReadCalls?: number;
  content: string;
}): boolean {
  if (input.toolCallCount > 0) {
    return false;
  }
  if ((input.fileReadCalls ?? 0) > 0) {
    return false;
  }
  if (
    input.route !== "repository_answer" &&
    input.route !== "diagnose" &&
    input.route !== "direct_answer"
  ) {
    return false;
  }
  return claimsMissingWorkspaceContext(input.content);
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
  if (!input.primaryTaskIntent) {
    return false;
  }
  return requiresMutationIntent(input.primaryTaskIntent, input.reasonCodes);
}

export function buildUnfulfilledExecuteRecoveryMessage(
  _mutationBudget?: MutationBudget,
): string {
  return [
    "You described the fix but did not call apply_patch.",
    "Do not repeat the diagnosis or write a report.",
    "Prefer calling apply_patch now for the next bounded batch using the live working-set mutation budget and compiler/preflight sections.",
    "If a write/mustRead path for the active checklist row is still missing from evidence, you may call read_file or read_many_files for those paths (a few turns) — then patch.",
    "Do not call list_directory, glob_files, search_files, or run_readonly_command for broad rediscovery on this recovery turn.",
    "If you still cannot make a bounded edit from evidence, stop with a clear blocker. Do not end this turn with analysis only.",
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
