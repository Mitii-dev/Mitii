import { describe, expect, it, beforeEach } from 'vitest';

import {
  clearModelsDevPricingCache,
  estimateSessionCost,
  formatUsd,
  lookupModelCostRates,
  modelsDevProviderId,
  type ModelsDevCatalog,
} from './modelPricing.js';

const SAMPLE: ModelsDevCatalog = {
  'ollama-cloud': {
    id: 'ollama-cloud',
    models: {
      'deepseek-v4.1-flash': {
        id: 'deepseek-v4.1-flash',
        cost: { input: 0.15, output: 0.6, cache_read: 0.003 },
      },
      'kimi-k3': {
        id: 'kimi-k3',
        cost: { input: 3, output: 15, cache_read: 0.3 },
      },
    },
  },
  openai: {
    id: 'openai',
    models: {
      'gpt-4o-mini': {
        id: 'gpt-4o-mini',
        cost: { input: 0.15, output: 0.6 },
      },
    },
  },
};

describe('modelPricing', () => {
  beforeEach(() => {
    clearModelsDevPricingCache();
  });

  it('maps presets to models.dev provider ids', () => {
    expect(modelsDevProviderId('ollama-cloud')).toBe('ollama-cloud');
    expect(modelsDevProviderId('ollama')).toBeNull();
    expect(modelsDevProviderId('lm-studio')).toBeNull();
    expect(modelsDevProviderId('openai')).toBe('openai');
  });

  it('looks up rates by model id', () => {
    const rates = lookupModelCostRates(
      SAMPLE,
      'ollama-cloud',
      'deepseek-v4.1-flash',
    );
    expect(rates).toEqual({
      input: 0.15,
      output: 0.6,
      cacheRead: 0.003,
    });
  });

  it('returns null for local providers and missing models', () => {
    expect(lookupModelCostRates(SAMPLE, 'ollama', 'llama3')).toBeNull();
    expect(
      lookupModelCostRates(SAMPLE, 'ollama-cloud', 'no-such-model'),
    ).toBeNull();
    expect(lookupModelCostRates(null, 'openai', 'gpt-4o-mini')).toBeNull();
  });

  it('estimates cost with cache hits at cache_read rate', () => {
    const rates = lookupModelCostRates(SAMPLE, 'ollama-cloud', 'kimi-k3')!;
    const estimate = estimateSessionCost(rates, {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheHitTokens: 800_000,
      cacheMissTokens: 200_000,
    });
    expect(estimate).not.toBeNull();
    // input: 200k * $3 + 800k * $0.30 = 0.6 + 0.24 = 0.84
    // output: 100k * $15 = 1.5
    expect(estimate!.inputUsd).toBeCloseTo(0.84, 6);
    expect(estimate!.outputUsd).toBeCloseTo(1.5, 6);
    expect(estimate!.totalUsd).toBeCloseTo(2.34, 6);
    expect(estimate!.usedCachePricing).toBe(true);
    expect(estimate!.cacheSavingsUsd).toBeCloseTo(2.16, 6);
  });

  it('bills all input at full rate when cache unknown', () => {
    const rates = lookupModelCostRates(SAMPLE, 'openai', 'gpt-4o-mini')!;
    const estimate = estimateSessionCost(rates, {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(estimate!.totalUsd).toBeCloseTo(0.15, 6);
    expect(estimate!.usedCachePricing).toBe(false);
  });

  it('maps ollama.com base URLs even when preset is openai-compatible', () => {
    expect(
      modelsDevProviderId('openai-compatible', 'https://ollama.com/v1'),
    ).toBe('ollama-cloud');
    expect(
      lookupModelCostRates(
        SAMPLE,
        'openai-compatible',
        'deepseek-v4.1-flash',
        'https://ollama.com/v1',
      ),
    ).toEqual({
      input: 0.15,
      output: 0.6,
      cacheRead: 0.003,
    });
  });

  it('formats usd compactly', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.0004)).toBe('$0.0004');
    expect(formatUsd(0.042)).toBe('$0.042');
    expect(formatUsd(12.345)).toBe('$12.35');
  });
});
