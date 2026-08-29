import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../../../modules/prompt-construction/policy";

/**
 * Per-turn max_tokens follows leftover context so a 10k-free window can
 * write ~10k. The planning reserve is not a generation ceiling unless the
 * caller passes a real host override as reservedOutputTokens.
 */
export function clampTurnMaximumOutputTokens(params: {
  reservedOutputTokens: number;
  contextWindowTokens: number;
  usedInputTokens: number;
}): number {
  const contextWindowTokens = Math.max(1, Math.floor(params.contextWindowTokens));
  const reservedOutputTokens = Math.max(1, Math.floor(params.reservedOutputTokens));
  const usedInputTokens = Math.max(0, Math.floor(params.usedInputTokens));
  const remaining = Math.max(1, contextWindowTokens - usedInputTokens);
  const scaled = Math.max(
    1,
    Math.floor(remaining * PROMPT_CONSTRUCTION_THRESHOLDS.dynamicOutputWindowRatio),
  );
  return Math.max(1, Math.min(reservedOutputTokens, scaled, remaining - 1, remaining));
}
