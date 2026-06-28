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

  const preferMinilm =
    config.embeddingProvider === 'minilm' ||
    (config.embeddingProvider === 'hash' && isTransformersEmbeddingAvailable());

  if (preferMinilm && isTransformersEmbeddingAvailable()) {
    return new TransformersEmbeddingProvider();
  }

  return new HashEmbeddingProvider();
}

export function describeEmbeddingProvider(config: IndexingConfig): string {
  if (!config.vectorsEnabled) return 'none';
  if (isTransformersEmbeddingAvailable() && config.embeddingProvider !== 'hash') {
    return 'minilm';
  }
  return config.embeddingProvider === 'minilm' ? 'minilm' : 'hash-fallback';
}
