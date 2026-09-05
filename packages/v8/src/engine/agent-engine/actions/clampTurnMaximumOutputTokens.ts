import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../../../modules/prompt-construction/policy";
import { resolveToolLoopMaxOutputTokens } from "../../../modules/window-budget";

/** Never emit a 1-token recovery turn when leftover context still allows a tool call. */
const MIN_TURN_OUTPUT_TOKENS = 256;

/**
 * Per-turn max_tokens follows leftover context so free window room is usable.
 *
 * Authority order (lowest wins):
 * 1. Leftover tokens: `contextWindowTokens - usedInputTokens`
 * 2. Scaled leftover (`dynamicOutputWindowRatio`)
 * 3. Generation ceiling / host override (`reservedOutputTokens`)
 *
 * Tool-loop turns also apply a hard cap so local models cannot turn leftover
 * context into a long analysis budget instead of calling tools.
 */
export function clampTurnMaximumOutputTokens(params: {
  reservedOutputTokens: number;
  contextWindowTokens: number;
  usedInputTokens: number;
  /** Mid-loop / tool-capable turns use a tighter band-scaled ceiling. */
  toolLoop?: boolean;
}): number {
  const contextWindowTokens = Math.max(1, Math.floor(params.contextWindowTokens));
  const reservedOutputTokens = Math.max(1, Math.floor(params.reservedOutputTokens));
  const usedInputTokens = Math.max(0, Math.floor(params.usedInputTokens));
  const remaining = Math.max(1, contextWindowTokens - usedInputTokens);
  const usable = Math.max(1, remaining - 1);
  const scaled = Math.max(
    1,
    Math.floor(remaining * PROMPT_CONSTRUCTION_THRESHOLDS.dynamicOutputWindowRatio),
  );
  let capped = Math.min(reservedOutputTokens, scaled, usable);
  if (params.toolLoop) {
    capped = Math.min(capped, resolveToolLoopMaxOutputTokens(contextWindowTokens));
  }
  const floor = Math.min(MIN_TURN_OUTPUT_TOKENS, usable);
  return Math.max(floor, Math.max(1, capped));
}
