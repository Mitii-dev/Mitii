import type { WindowBudgetPolicyOverrides } from "./contracts";
import { resolveWindowBudgetPolicy } from "./policy";
import { WINDOW_BUDGET_BAND_CEILINGS } from "./windowBudgetBands";

/**
 * Absolute tool-loop output ceiling for compact windows. Local models often
 * pad/repeat until max_tokens; a 13k (or even 8k) allocation turns a short
 * tool call into a full-budget hallucinated burn. Keep this tight.
 */
export const COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP = 5_000;

/**
 * Continuous tool-loop / execute output ceiling from the advertised context window.
 *
 * Uses the same resolved `outputWindowCapRatio` as planning generation
 * (defaults → window band → optional host overrides). Compact windows also
 * apply {@link COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP}.
 */
export function resolveToolLoopMaxOutputTokens(
  contextWindowTokens: number,
  overrides?: WindowBudgetPolicyOverrides,
): number {
  const resolved = resolveWindowBudgetPolicy({
    contextWindowTokens,
    overrides,
  });
  const window = Math.max(1, resolved.contextWindowTokens);
  const ratio = resolved.policy.outputWindowCapRatio;
  let capped = Math.max(1, Math.floor(window * ratio));
  if (window < WINDOW_BUDGET_BAND_CEILINGS.compactMaxExclusive) {
    capped = Math.min(capped, COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP);
  }
  return capped;
}
