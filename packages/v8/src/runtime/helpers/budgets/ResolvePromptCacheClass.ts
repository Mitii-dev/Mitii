export const PROMPT_CACHE_CLASSES = ["no_cache", "prompt_cache"] as const;

export type PromptCacheClass = (typeof PROMPT_CACHE_CLASSES)[number];

export interface ResolvePromptCacheClassInput {
  /** Adapter capability — Anthropic/OpenAI-compatible may advertise support. */
  supportsPromptCaching?: boolean;
  /** Cumulative cache-hit tokens observed so far in this run. */
  cacheHitTokens?: number;
  /** Cumulative cache-miss / cache-write tokens observed so far in this run. */
  cacheMissTokens?: number;
  /** Completed model calls in this run (0 before the first call finishes). */
  modelCalls?: number;
  /**
   * After this many completed calls with neither hit nor miss tokens reported,
   * treat the provider as non-reporting and use `no_cache` (typical local
   * Ollama/Qwen). Default 2.
   */
  noReportAfterCalls?: number;
}

/**
 * Decide whether the model-loop should preserve the message prefix for
 * provider prompt caches (`prompt_cache`) or compact earlier (`no_cache`).
 *
 * Locals that advertise caching but never report hit/miss fall through to
 * `no_cache` so preservePrefix does not inflate a full-price window.
 */
export function resolvePromptCacheClass(
  input: ResolvePromptCacheClassInput,
): PromptCacheClass {
  if (!input.supportsPromptCaching) {
    return "no_cache";
  }

  const hits = Math.max(0, Math.floor(input.cacheHitTokens ?? 0));
  const misses = Math.max(0, Math.floor(input.cacheMissTokens ?? 0));
  const modelCalls = Math.max(0, Math.floor(input.modelCalls ?? 0));
  const noReportAfter = Math.max(
    1,
    Math.floor(input.noReportAfterCalls ?? 2),
  );

  if (hits > 0) {
    return "prompt_cache";
  }

  // Provider reported cache activity (writes) even without reads yet.
  if (misses > 0) {
    return "prompt_cache";
  }

  // Early turns: give a caching provider a chance to establish a prefix.
  if (modelCalls < noReportAfter) {
    return "prompt_cache";
  }

  // Supported on paper but never reported — local/compatible runtimes.
  return "no_cache";
}

export function shouldPreserveModelLoopPrefix(
  cacheClass: PromptCacheClass,
): boolean {
  return cacheClass === "prompt_cache";
}
