import type { ModelToolCall } from "../../../modules/model-gateway";

/**
 * Rough character estimate of tool-call argument payloads (for headroom checks).
 */
export function estimateMutationPayloadCharacters(
  toolCalls: readonly ModelToolCall[],
): number {
  let total = 0;
  for (const call of toolCalls) {
    if (call.name !== "apply_patch") {
      continue;
    }
    total += call.arguments?.length ?? 0;
  }
  return total;
}
