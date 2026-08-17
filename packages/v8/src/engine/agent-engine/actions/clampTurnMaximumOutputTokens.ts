/**
 * Keep each model turn inside the window-derived output reserve and the
 * tokens still left after the current compacted prompt.
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
  return Math.max(1, Math.min(reservedOutputTokens, remaining - 1, remaining));
}
