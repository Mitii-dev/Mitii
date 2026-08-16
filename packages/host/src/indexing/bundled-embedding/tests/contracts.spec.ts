import { describe, expect, it } from 'vitest';

import {
  BundledEmbeddingModelCatalogSchema,
  EmbeddingSourceResolutionInputSchema,
  EmbeddingSourceResolutionSchema,
  EmbeddingSourceSchema,
} from '../contracts.js';
import { BUNDLED_MINILM_CATALOG } from '../catalog.js';

describe('bundled embedding contracts', () => {
  it('accepts the MiniLM catalog and infers a 384-d normalized source', () => {
    const catalog = BundledEmbeddingModelCatalogSchema.parse(BUNDLED_MINILM_CATALOG);
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.dimensions).toBe(384);
    expect(catalog.normalized).toBe(true);
    expect(catalog.pooling).toBe('mean');
    expect(catalog.assets.model.sha256).toHaveLength(64);
  });

  it('rejects unknown embedding sources', () => {
    expect(() => EmbeddingSourceSchema.parse('lancedb')).toThrow();
    expect(() =>
      EmbeddingSourceResolutionInputSchema.parse({
        requestedEnabled: true,
        baseUrl: 'http://localhost:11434/v1',
        embeddingModelConfigured: false,
      }),
    ).toThrow();
  });

  it('requires schemaVersion on the public resolution', () => {
    expect(() =>
      EmbeddingSourceResolutionSchema.parse({
        status: 'enabled',
        source: 'bundled',
        backend: 'bundled',
        model: 'all-MiniLM-L6-v2',
        dimensions: 384,
        normalized: true,
        reasonCode: 'default_bundled',
      }),
    ).toThrow();
  });
});
