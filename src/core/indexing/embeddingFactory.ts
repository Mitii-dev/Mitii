import type { IndexingConfig } from '../config/schema';
import {
  HashEmbeddingProvider,
  NoOpEmbeddingProvider,
  type EmbeddingProvider,
} from './EmbeddingProvider';
import { TransformersEmbeddingProvider } from './TransformersEmbeddingProvider';

export function createEmbeddingProvider(config: IndexingConfig): EmbeddingProvider {
  if (!config.vectorsEnabled) {
    return new NoOpEmbeddingProvider();
  }

  if (config.embeddingProvider === 'minilm') {
    return new TransformersEmbeddingProvider();
  }

  return new HashEmbeddingProvider();
}

export function describeEmbeddingProvider(config: IndexingConfig): string {
  if (!config.vectorsEnabled) return 'none';
  return config.embeddingProvider === 'minilm' ? 'minilm' : 'hash-fallback';
}
