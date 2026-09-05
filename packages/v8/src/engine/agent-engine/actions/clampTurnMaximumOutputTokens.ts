import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../../../modules/prompt-construction/policy";
import { resolveToolLoopMaxOutputTokens } from "../../../modules/window-budget";

/**
 * Per-turn max_tokens follows leftover context so a 10k-free window can
 * write ~10k. The planning reserve is not a generation ceiling unless the
 * caller passes a real host override as reservedOutputTokens.
 *
 * When `toolLoop` is true, also apply the band-scaled tool-loop ceiling so
 * execute turns cannot open a leftover-sized essay budget.
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
  const scaled = Math.max(
    1,
    Math.floor(remaining * PROMPT_CONSTRUCTION_THRESHOLDS.dynamicOutputWindowRatio),
  );
  let capped = Math.max(
    1,
    Math.min(reservedOutputTokens, scaled, remaining - 1, remaining),
  );
  if (params.toolLoop) {
    const toolLoopCap = resolveToolLoopMaxOutputTokens(contextWindowTokens);
    capped = Math.min(capped, toolLoopCap);
  }
  return Math.max(1, capped);
}
