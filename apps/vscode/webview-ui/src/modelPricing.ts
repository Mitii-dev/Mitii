/**
 * Estimated session cost from models.dev catalog rates.
 *
 * Cost is always an estimate (tokens × published $/1M). On catalog/lookup
 * failure we return null so UIs can hide the cost chip rather than guess.
 */

export const MODELS_DEV_API_URL = 'https://models.dev/api.json';

/** USD per million tokens (models.dev `cost` shape). */
export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
}

export interface TokenCostUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prefix tokens served from provider cache (billed at cacheRead when set). */
  cacheHitTokens?: number;
  /** Prompt tokens billed at full input rate when reported separately. */
  cacheMissTokens?: number;
}

export interface SessionCostEstimate {
  /** Total estimated USD for the usage snapshot. */
  totalUsd: number;
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  /** What input would have cost if every prompt token were billed at full rate. */
  uncachedInputUsd: number;
  /** uncachedInputUsd − inputUsd (savings from cache hits). */
  cacheSavingsUsd: number;
  rates: ModelCostRates;
  /** True when cache-hit tokens were applied at a cheaper cacheRead rate. */
  usedCachePricing: boolean;
}

type ModelsDevModel = {
  id?: string;
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
  };
};

type ModelsDevProvider = {
  id?: string;
  models?: Record<string, ModelsDevModel>;
};

export type ModelsDevCatalog = Record<string, ModelsDevProvider>;

/** Map Mitii provider preset / type → models.dev provider id. */
export function modelsDevProviderId(
  presetOrType: string | undefined,
  baseUrl?: string,
): string | null {
  const key = (presetOrType ?? '').trim().toLowerCase();
  switch (key) {
    case 'ollama-cloud':
      return 'ollama-cloud';
    case 'openai':
      return 'openai';
    case 'anthropic':
      return 'anthropic';
    case 'deepseek':
      return 'deepseek';
    case 'openrouter':
      return 'openrouter';
    case 'gemini':
    case 'google':
      return 'google';
    case 'azure-openai':
      return 'azure';
    case 'ollama':
    case 'lm-studio':
    case 'echo':
      return null;
    default:
      break;
  }
  // Custom openai-compatible profiles often keep type=openai-compatible
  // while pointing at a known cloud host.
  if (baseUrl && /(?:^|\/\/)(?:[\w-]+\.)?ollama\.com\b/i.test(baseUrl)) {
    return 'ollama-cloud';
  }
  if (baseUrl && /api\.openai\.com/i.test(baseUrl)) return 'openai';
  if (baseUrl && /api\.anthropic\.com/i.test(baseUrl)) return 'anthropic';
  if (baseUrl && /api\.deepseek\.com/i.test(baseUrl)) return 'deepseek';
  if (baseUrl && /openrouter\.ai/i.test(baseUrl)) return 'openrouter';
  if (baseUrl && /generativelanguage\.googleapis\.com/i.test(baseUrl)) {
    return 'google';
  }
  return null;
}

/** Local / free providers — never show a dollar estimate. */
export function isPricedCloudProvider(
  presetOrType: string | undefined,
  baseUrl?: string,
): boolean {
  return modelsDevProviderId(presetOrType, baseUrl) !== null;
}

function normalizeModelKey(id: string): string {
  return id.trim().toLowerCase().replace(/^models\//, '');
}

function modelKeyCandidates(modelId: string): string[] {
  const raw = modelId.trim();
  if (!raw) return [];
  const lower = normalizeModelKey(raw);
  const noTag = lower.replace(/:latest$/, '');
  const bare = noTag.includes('/') ? (noTag.split('/').pop() ?? noTag) : noTag;
  const unique = new Set<string>([lower, noTag, bare, raw.toLowerCase()]);
  return [...unique].filter(Boolean);
}

function ratesFromEntry(entry: ModelsDevModel | undefined): ModelCostRates | null {
  const cost = entry?.cost;
  if (!cost) return null;
  if (typeof cost.input !== 'number' || typeof cost.output !== 'number') {
    return null;
  }
  if (!Number.isFinite(cost.input) || !Number.isFinite(cost.output)) {
    return null;
  }
  return {
    input: cost.input,
    output: cost.output,
    ...(typeof cost.cache_read === 'number' && Number.isFinite(cost.cache_read)
      ? { cacheRead: cost.cache_read }
      : {}),
    ...(typeof cost.cache_write === 'number' && Number.isFinite(cost.cache_write)
      ? { cacheWrite: cost.cache_write }
      : {}),
    ...(typeof cost.reasoning === 'number' && Number.isFinite(cost.reasoning)
      ? { reasoning: cost.reasoning }
      : {}),
  };
}

/**
 * Look up per-million rates for a Mitii preset + model id.
 * Returns null when the provider is local, unknown, or the model has no cost.
 */
export function lookupModelCostRates(
  catalog: ModelsDevCatalog | null | undefined,
  presetOrType: string | undefined,
  modelId: string | undefined,
  baseUrl?: string,
): ModelCostRates | null {
  if (!catalog || !modelId?.trim()) return null;
  const providerId = modelsDevProviderId(presetOrType, baseUrl);
  if (!providerId) return null;
  const provider = catalog[providerId];
  const models = provider?.models;
  if (!models) return null;

  const byNormalized = new Map<string, ModelsDevModel>();
  for (const [id, entry] of Object.entries(models)) {
    byNormalized.set(normalizeModelKey(id), entry);
    if (entry.id) byNormalized.set(normalizeModelKey(entry.id), entry);
  }

  for (const candidate of modelKeyCandidates(modelId)) {
    const direct = models[candidate] ?? byNormalized.get(candidate);
    const rates = ratesFromEntry(direct);
    if (rates) return rates;
  }

  // Fuzzy: ends-with / contains bare name (e.g. kimi-k3 vs moonshotai/kimi-k3).
  const bare = modelKeyCandidates(modelId).sort((a, b) => b.length - a.length)[0];
  if (bare && bare.length >= 3) {
    for (const [id, entry] of Object.entries(models)) {
      const norm = normalizeModelKey(id);
      if (norm === bare || norm.endsWith(`/${bare}`) || norm.endsWith(`:${bare}`)) {
        const rates = ratesFromEntry(entry);
        if (rates) return rates;
      }
    }
  }

  return null;
}

function tokensToUsd(tokens: number, ratePerMillion: number): number {
  return (Math.max(0, tokens) / 1_000_000) * ratePerMillion;
}

/**
 * Estimate USD for a usage snapshot. Returns null when rates are missing.
 * When cache hits are unknown, bills all input at the full input rate
 * (conservative overestimate for Ollama Cloud until they report cache stats).
 */
export function estimateSessionCost(
  rates: ModelCostRates | null | undefined,
  usage: TokenCostUsage,
): SessionCostEstimate | null {
  if (!rates) return null;
  const input = Math.max(0, usage.inputTokens);
  const output = Math.max(0, usage.outputTokens);
  const cacheHit = Math.max(0, usage.cacheHitTokens ?? 0);
  const explicitMiss = usage.cacheMissTokens;
  const hasCacheBreakdown =
    (usage.cacheHitTokens !== undefined && usage.cacheHitTokens > 0) ||
    (usage.cacheMissTokens !== undefined && usage.cacheMissTokens > 0);

  let billedFullInput = input;
  let billedCacheRead = 0;
  let usedCachePricing = false;

  if (hasCacheBreakdown && rates.cacheRead !== undefined) {
    billedCacheRead = Math.min(cacheHit, input);
    if (typeof explicitMiss === 'number' && Number.isFinite(explicitMiss)) {
      billedFullInput = Math.max(0, explicitMiss);
    } else {
      billedFullInput = Math.max(0, input - billedCacheRead);
    }
    usedCachePricing = billedCacheRead > 0;
  }

  const inputUsd =
    tokensToUsd(billedFullInput, rates.input) +
    tokensToUsd(billedCacheRead, rates.cacheRead ?? rates.input);
  const outputUsd = tokensToUsd(output, rates.output);
  const cacheReadUsd = tokensToUsd(
    billedCacheRead,
    rates.cacheRead ?? rates.input,
  );
  const uncachedInputUsd = tokensToUsd(input, rates.input);
  // Savings = full-rate input − actual input bill (includes cache portion).
  const cacheSavingsUsd = Math.max(0, uncachedInputUsd - inputUsd);

  return {
    totalUsd: inputUsd + outputUsd,
    inputUsd,
    outputUsd,
    cacheReadUsd,
    uncachedInputUsd,
    cacheSavingsUsd,
    rates,
    usedCachePricing,
  };
}

/** Compact Cloudflare-style money label. */
export function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return '—';
  }
  const abs = Math.abs(amount);
  if (abs === 0) return '$0';
  if (abs < 0.001) return `$${amount.toFixed(4)}`;
  if (abs < 0.01) return `$${amount.toFixed(3)}`;
  if (abs < 10) return `$${amount.toFixed(3)}`;
  if (abs < 100) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(2)}`;
}

export interface ModelsDevPricingCache {
  catalog: ModelsDevCatalog;
  fetchedAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

let memoryCache: ModelsDevPricingCache | null = null;
let inflight: Promise<ModelsDevCatalog | null> | null = null;

export function clearModelsDevPricingCache(): void {
  memoryCache = null;
  inflight = null;
}

export function getCachedModelsDevCatalog(): ModelsDevCatalog | null {
  return memoryCache?.catalog ?? null;
}

/**
 * Fetch models.dev catalog. On failure returns last good cache, else null
 * (caller should hide cost UI).
 */
export async function fetchModelsDevCatalog(options?: {
  url?: string;
  ttlMs?: number;
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ModelsDevCatalog | null> {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  if (
    !options?.force &&
    memoryCache &&
    now - memoryCache.fetchedAt < ttlMs
  ) {
    return memoryCache.catalog;
  }

  if (inflight) return inflight;

  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return memoryCache?.catalog ?? null;
  }

  inflight = (async () => {
    try {
      const response = await fetchImpl(options?.url ?? MODELS_DEV_API_URL, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return memoryCache?.catalog ?? null;
      }
      const json = (await response.json()) as unknown;
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return memoryCache?.catalog ?? null;
      }
      const catalog = json as ModelsDevCatalog;
      memoryCache = { catalog, fetchedAt: Date.now() };
      return catalog;
    } catch {
      return memoryCache?.catalog ?? null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Resolve rates for a profile, fetching the catalog when needed. */
export async function resolveModelCostRates(input: {
  presetOrType: string | undefined;
  modelId: string | undefined;
  baseUrl?: string;
  forceRefresh?: boolean;
}): Promise<ModelCostRates | null> {
  if (!isPricedCloudProvider(input.presetOrType, input.baseUrl)) return null;
  const catalog = await fetchModelsDevCatalog({ force: input.forceRefresh });
  return lookupModelCostRates(
    catalog,
    input.presetOrType,
    input.modelId,
    input.baseUrl,
  );
}
