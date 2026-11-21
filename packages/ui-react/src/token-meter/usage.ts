import type { TokenUsageState } from './types.js';

export function emptyTokenUsage(contextWindow = 0): TokenUsageState {
  return {
    inputTokensTotal: 0,
    outputTokensTotal: 0,
    sessionTotal: 0,
    modelCalls: 0,
    toolCalls: 0,
    turnCount: 0,
    lastPromptTokens: 0,
    lastResponseTokens: 0,
    currentTurnTotal: 0,
    contextWindow,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
  };
}

/** Fold one model call into cumulative usage (negative inputs clamp to 0). */
export function addTurnTokens<T extends TokenUsageState>(
  prev: T,
  input: number,
  output: number,
  cache?: { hit?: number; miss?: number },
): T {
  const safeIn = Math.max(0, input);
  const safeOut = Math.max(0, output);
  const inputTokensTotal = prev.inputTokensTotal + safeIn;
  const outputTokensTotal = prev.outputTokensTotal + safeOut;
  return {
    ...prev,
    inputTokensTotal,
    outputTokensTotal,
    sessionTotal: inputTokensTotal + outputTokensTotal,
    modelCalls: prev.modelCalls + 1,
    turnCount: prev.turnCount + 1,
    lastPromptTokens: safeIn,
    lastResponseTokens: safeOut,
    currentTurnTotal: safeIn + safeOut,
    cacheHitTokens: prev.cacheHitTokens + Math.max(0, cache?.hit ?? 0),
    cacheMissTokens: prev.cacheMissTokens + Math.max(0, cache?.miss ?? 0),
    live: true,
  };
}
