import type { ModelToolCall } from "../../../../modules/model-gateway";

/**
 * True when a streamed tool call has parseable args (and valid apply_patch shape).
 * Incomplete truncated calls must be discarded before settlement.
 */
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

/** Keep only complete tool calls; drop truncated/incomplete fragments. */
export function discardIncompleteToolCalls(
  calls: readonly ModelToolCall[],
): {
  complete: ModelToolCall[];
  discardedCount: number;
} {
  const complete = calls.filter(isCompleteToolCall);
  return {
    complete,
    discardedCount: calls.length - complete.length,
  };
}
