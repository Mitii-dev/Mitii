/**
 * Resolve the effective LLM context window for host-composed ports.
 *
 * Priority (matches Desktop / VS Code):
 * 1. Explicit stored / env / config value when positive
 * 2. Infer from model id tags (`…-64k`, `…:65536`) and known families
 * 3. Provider-type fallback
 * 4. Default 32_768 (OpenAI-compatible last resort only)
 *
 * Hosts must pass the result into `createHostLlmPorts({ capabilities })` so
 * engine window policy does not silently inherit the adapter default.
 */

export const DEFAULT_CONTEXT_WINDOW = 32_768;

const PROVIDER_CONTEXT_WINDOW_FALLBACKS: Readonly<Record<string, number>> = {
  anthropic: 200_000,
  gemini: 1_048_576,
  openai: 128_000,
  'openai-compatible': 32_768,
  ollama: 32_768,
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
 * Effective context window: **explicit stored wins** when positive.
 * Auto (0 / unset) falls back to model tags → provider → 32_768.
 */
export function resolveEffectiveContextWindow(
  stored: number,
  model: string,
  providerType?: string,
): number {
  if (Number.isFinite(stored) && stored > 0) return Math.floor(stored);
  const fromModel = inferContextWindowFromModelId(model);
  if (fromModel) return fromModel;
  const typeKey = (providerType ?? '').trim().toLowerCase();
  if (typeKey && PROVIDER_CONTEXT_WINDOW_FALLBACKS[typeKey]) {
    return PROVIDER_CONTEXT_WINDOW_FALLBACKS[typeKey]!;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * Parse a positive token count from env / config (number or numeric string).
 * Returns 0 when absent or invalid (treated as auto by resolveEffectiveContextWindow).
 */
export function parseContextWindowTokens(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const asK = trimmed.match(/^(\d+)\s*k$/i);
    if (asK) {
      const n = Number(asK[1]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n * 1024);
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

/**
 * Resolve context window for headless hosts (CLI / automation / benchmark)
 * from env + optional config fields + model/provider inference.
 */
export function resolveHostContextWindowTokens(params: {
  env?: NodeJS.ProcessEnv;
  model: string;
  providerType?: string;
  /** Explicit config value (`.mitii/config.json` contextWindowTokens, etc.). */
  configContextWindowTokens?: unknown;
}): number {
  const env = params.env ?? process.env;
  const fromEnv = parseContextWindowTokens(
    env.MITII_CONTEXT_WINDOW ?? env.MITII_CONTEXT_WINDOW_TOKENS,
  );
  const fromConfig = parseContextWindowTokens(params.configContextWindowTokens);
  const stored = fromEnv > 0 ? fromEnv : fromConfig;
  return resolveEffectiveContextWindow(
    stored,
    params.model,
    params.providerType,
  );
}
