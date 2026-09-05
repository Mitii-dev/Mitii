import type { WindowBudgetBand } from "./windowBudgetBands";
import { resolveWindowBudgetBand } from "./windowBudgetBands";

/**
 * Band-scaled ceiling for tool-loop / execute turns.
 * Keeps leftover-context clamping from opening a 30k+ generation budget mid-loop
 * while still leaving enough room for a real batched patch.
 */
export const TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND: Record<
  WindowBudgetBand,
  number
> = {
  compact: 4_096,
  standard: 8_192,
  wide: 8_192,
};

export function resolveToolLoopMaxOutputTokens(
  contextWindowTokens: number,
): number {
  const band = resolveWindowBudgetBand(contextWindowTokens);
  return TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND[band];
}
