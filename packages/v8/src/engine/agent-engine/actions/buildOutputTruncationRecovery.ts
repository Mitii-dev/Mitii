import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { MutationBudget } from "../../../modules/decision-policy";

import { AGENT_ENGINE_THRESHOLDS } from "../policy";

export interface TruncationRecoveryPlan {
  /** Whether the Engine should discard tool calls and continue with a nudge. */
  shouldRecover: boolean;
  /** Incomplete / unparseable tool calls that must not be executed. */
  incompleteToolCalls: ModelToolCall[];
  /** Assistant message content to keep (no broken toolCalls). */
  assistantContent: string;
  /** User nudge instructing a smaller batch. */
  recoveryMessage: ModelMessage;
}

/**
 * Decide whether a length-truncated model turn should recover instead of
 * executing incomplete tool calls or ending the run.
 */
export function buildOutputTruncationRecovery(params: {
  finishReason?: string;
  content: string;
  toolCalls: readonly ModelToolCall[];
  mutationBudget?: MutationBudget;
  recoveryAttempt: number;
}): TruncationRecoveryPlan | null {
  const truncated = params.finishReason === "length";
  if (!truncated) {
    return null;
  }

  if (
    params.recoveryAttempt >= AGENT_ENGINE_THRESHOLDS.maxTruncationRecoveries
  ) {
    return null;
  }

  const incompleteToolCalls = params.toolCalls.filter(
    (call) => !isCompleteToolCall(call),
  );

  // Only recover when truncated mid-tool-call (broken JSON / empty args).
  // Complete tool calls after a length stop are still executable.
  const shouldRecover = incompleteToolCalls.length > 0;

  if (!shouldRecover) {
    // Truncated final text answer, or truncated after complete tools —
    // let the normal loop path handle them.
    return null;
  }

  const preferred =
    params.mutationBudget?.preferredBatchSize ??
    AGENT_ENGINE_THRESHOLDS.defaultPreferredBatchSize;
  const maxPatches =
    params.mutationBudget?.maxPatchesPerCall ??
    AGENT_ENGINE_THRESHOLDS.defaultMaxPatchesPerCall;

  const recoveryMessage: ModelMessage = {
    role: "user",
    content: [
      "Your previous response was truncated because the output token limit was reached.",
      "Do not repeat the oversized tool call.",
      `Continue the task with a smaller batch: at most ${preferred} files (hard max ${maxPatches} patches) per apply_patch.`,
      "Prefer minimal oldText/newText hunks — never rewrite whole files unless required.",
      "If many files remain, apply the next batch now and leave the rest for later turns.",
    ].join("\n"),
  };

  return {
    shouldRecover: true,
    incompleteToolCalls: [...incompleteToolCalls],
    assistantContent:
      params.content.trim().length > 0
        ? `${params.content}\n\n…(output truncated — retrying with a smaller batch)`
        : "(previous model output truncated — retrying with a smaller batch)",
    recoveryMessage,
  };
}

export function isCompleteToolCall(call: ModelToolCall): boolean {
  if (!call.name || call.name.length === 0) {
    return false;
  }
  const raw = call.arguments?.trim() ?? "";
  if (raw.length === 0) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (call.name === "apply_patch") {
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("patches" in parsed) ||
        !Array.isArray((parsed as { patches: unknown }).patches) ||
        (parsed as { patches: unknown[] }).patches.length === 0
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
