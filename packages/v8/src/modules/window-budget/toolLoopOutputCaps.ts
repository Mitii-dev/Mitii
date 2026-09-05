import type { WindowBudgetBand } from "./windowBudgetBands";
import { resolveWindowBudgetBand } from "./windowBudgetBands";

/**
 * Band-scaled ceiling for tool-loop / execute turns.
 * Keeps leftover-context clamping from opening a 10–20k essay budget mid-loop.
 * Final summary / design-only turns may still use the generation ceiling.
 */
export const TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND: Record<
  WindowBudgetBand,
  number
> = {
  compact: 2_048,
  standard: 3_072,
  wide: 4_096,
};

export function resolveToolLoopMaxOutputTokens(
  contextWindowTokens: number,
): number {
  const band = resolveWindowBudgetBand(contextWindowTokens);
  return TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND[band];
}
