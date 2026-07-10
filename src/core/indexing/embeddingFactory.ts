import type { IndexingConfig } from '../config/schema';
import {
  HashEmbeddingProvider,
  NoOpEmbeddingProvider,
  type EmbeddingProvider,
} from './EmbeddingProvider';
import { TransformersEmbeddingProvider, isTransformersEmbeddingAvailable } from './TransformersEmbeddingProvider';

export function createEmbeddingProvider(config: IndexingConfig): EmbeddingProvider {
  if (!config.vectorsEnabled) {
    return new NoOpEmbeddingProvider();
  }

  if (config.embeddingProvider === 'minilm' && isTransformersEmbeddingAvailable()) {
    return new TransformersEmbeddingProvider();
  }

  return new HashEmbeddingProvider();
}

/** Static description from config + package availability only — does not reflect whether the
 * model has actually loaded successfully at runtime. See TransformersEmbeddingProvider.getHealth(). */
export function describeEmbeddingProvider(config: IndexingConfig): string {
  if (!config.vectorsEnabled) return 'none';
  if (config.embeddingProvider === 'minilm') {
    return isTransformersEmbeddingAvailable() ? 'minilm' : 'hash-fallback';
  }
  return 'hash';
}
