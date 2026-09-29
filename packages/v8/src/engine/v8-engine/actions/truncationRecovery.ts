/**
 * Truncation vs reasoning recovery — keep the rails separate.
 * Reasoning-budget aborts must not burn the provider length-recovery counter.
 */

export type TruncationRecoveryKind =
  | "none"
  | "tool_call"
  | "text_continuation"
  | "reasoning_abort";

export type TruncationRecoveryDecision = {
  kind: TruncationRecoveryKind;
  /** Whether the engine should open another model turn. */
  shouldRecover: boolean;
  /** User/system nudge content when shouldRecover. */
  message?: string;
  /** Reset truncation attempt counter because a tool call progressed. */
  resetCounter?: boolean;
};

/**
 * Decide recovery after a model turn.
 */
export function decideTruncationRecovery(params: {
  finishReason?: string;
  reasoningBudgetExceeded?: boolean;
  hasToolCalls: boolean;
  incompleteToolCalls: boolean;
  truncationRecoveriesUsed: number;
  maxTruncationRecoveries: number;
  requireMutation?: boolean;
}): TruncationRecoveryDecision {
  if (params.hasToolCalls && !params.incompleteToolCalls) {
    return {
      kind: "none",
      shouldRecover: false,
      resetCounter: true,
    };
  }

  if (params.reasoningBudgetExceeded) {
    return {
      kind: "reasoning_abort",
      shouldRecover: true,
      message: [
        "Your previous turn spent the reasoning budget without emitting a tool call or user-facing answer.",
        "Do not continue that essay.",
        params.requireMutation
          ? "Call apply_patch (or one targeted read_file of a path already named in the request), then patch."
          : "Call one essential tool or give a short final answer now.",
      ].join("\n"),
    };
  }

  const truncated = params.finishReason === "length";
  if (!truncated) {
    return { kind: "none", shouldRecover: false };
  }

  if (params.truncationRecoveriesUsed >= params.maxTruncationRecoveries) {
    return { kind: "none", shouldRecover: false };
  }

  if (params.incompleteToolCalls || params.requireMutation) {
    return {
      kind: "tool_call",
      shouldRecover: true,
      message: [
        "Your previous response was truncated because the output token limit was reached.",
        "Do not repeat an oversized tool call.",
        "Continue with a smaller apply_patch batch (or one essential tool).",
      ].join("\n"),
    };
  }

  return {
    kind: "text_continuation",
    shouldRecover: true,
    message: [
      "Your previous answer was truncated because the output token limit was reached.",
      "Continue exactly where it stopped. Do not restart.",
    ].join("\n"),
  };
}

/** Host-facing warning — do not blame maximumOutputTokens for reasoning cuts. */
export function truncationWarningMessage(params: {
  reasoningBudgetExceeded?: boolean;
}): string {
  if (params.reasoningBudgetExceeded) {
    return "Reasoning progress budget exceeded before any tool call (not an output-token limit).";
  }
  return "Response truncated: output token limit reached.";
}
