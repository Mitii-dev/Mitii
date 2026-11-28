/**
 * Prompt-cache capability (§11.4) — branch on capability, never model name.
 */

export const PROMPT_CACHE_CAPABILITIES = [
  "none",
  "anthropic_ephemeral",
  "openai_prefix",
] as const;

export type PromptCacheCapability = (typeof PROMPT_CACHE_CAPABILITIES)[number];

/** Map gateway-style boolean (+ optional vendor hint) → capability enum. */
export function resolvePromptCacheCapability(input: {
  supportsPromptCaching?: boolean;
  /** Explicit capability when host/gateway already resolved it. */
  promptCache?: PromptCacheCapability;
}): PromptCacheCapability {
  if (input.promptCache) return input.promptCache;
  if (input.supportsPromptCaching === true) return "anthropic_ephemeral";
  return "none";
}
