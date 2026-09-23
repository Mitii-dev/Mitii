/**
 * Resolve the effective context window for Desktop host / LLM ports.
 * Mirrors VS Code `resolveEffectiveContextWindow` (+ local :64k / :32k tags).
 */

export const DEFAULT_CONTEXT_WINDOW = 32_768;

const PROVIDER_CONTEXT_WINDOW_FALLBACKS: Readonly<Record<string, number>> = {
  anthropic: 200_000,
  gemini: 1_048_576,
  openai: 128_000,
  'openai-compatible': 32_768,
};

/** Known exact / prefix model ids → context window. */
const MODEL_CONTEXT_PRESETS: ReadonlyArray<{ match: RegExp; window: number }> = [
  { match: /^qwen3-coder:30b$/i, window: 262_144 },
  { match: /^qwen3\.5(?::|$)/i, window: 256_000 },
  { match: /devstral/i, window: 128_000 },
  { match: /codestral/i, window: 32_768 },
  { match: /gemma4/i, window: 128_000 },
  { match: /llama3/i, window: 128_000 },
  { match: /\bmistral\b/i, window: 32_768 },
  { match: /claude/i, window: 200_000 },
  { match: /gemini/i, window: 1_048_576 },
  { match: /deepseek/i, window: 128_000 },
  { match: /^(gpt-|o1|o3|o4)/i, window: 128_000 },
];

/**
 * Infer from model id tags like `my-qwen-64k:latest` or `…:65536`.
 */
export function inferContextWindowFromModelId(
  model: string,
): number | undefined {
  const id = model.trim().toLowerCase();
  if (!id) return undefined;

  const tagged = id.match(/(?:^|[-_:])(\d+)\s*k(?:[-_:]|$)/i);
  if (tagged) {
    const n = Number(tagged[1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n * 1024);
  }
  const bare = id.match(/(?:^|[-_:])(\d{4,7})(?:[-_:]|$)/);
  if (bare) {
    const n = Number(bare[1]);
    // Only treat as a window when it looks like a token budget, not a param count.
    if (n >= 8_192 && n <= 1_048_576) return n;
  }

  for (const preset of MODEL_CONTEXT_PRESETS) {
    if (preset.match.test(id)) return preset.window;
  }
  return undefined;
}

/**
 * Effective context window: **stored settings win** when positive.
 * Auto (0) falls back to model tags → provider → 32_768.
 */
export function resolveEffectiveContextWindow(
  stored: number,
  model: string,
  providerType?: string,
): number {
  if (stored > 0) return Math.floor(stored);
  const fromModel = inferContextWindowFromModelId(model);
  if (fromModel) return fromModel;
  const typeKey = (providerType ?? '').trim().toLowerCase();
  if (typeKey && PROVIDER_CONTEXT_WINDOW_FALLBACKS[typeKey]) {
    return PROVIDER_CONTEXT_WINDOW_FALLBACKS[typeKey]!;
  }
  return DEFAULT_CONTEXT_WINDOW;
}
