import type { WindowBudgetBand } from "./windowBudgetBands";
import { resolveWindowBudgetBand } from "./windowBudgetBands";

/**
 * Band-scaled ceiling for tool-loop / execute turns.
 * Keeps leftover-context clamping from opening a 30k+ generation budget mid-loop
 * while still leaving enough room for a real batched patch.
 *
 * Compact was raised off 4k so ~45k windows are not starved into extra patch
 * turns when leftover context is still large; still far below full leftover.
 */
export const TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND: Record<
  WindowBudgetBand,
  number
> = {
  compact: 8_192,
  standard: 10_240,
  wide: 12_288,
};

export function resolveToolLoopMaxOutputTokens(
  contextWindowTokens: number,
): number {
  const band = resolveWindowBudgetBand(contextWindowTokens);
  return TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND[band];
}
