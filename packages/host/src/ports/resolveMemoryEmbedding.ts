import { HashMemoryEmbedding, type MemoryEmbeddingPort } from '@mitii/v8';

import {
  createHostEmbeddingProvider,
  type SemanticIndexSettings,
} from '../indexing/semanticIndex.js';
import { createMemoryEmbeddingPort } from './memoryEmbeddingAdapter.js';

/**
 * Sync embedding port for Memory retrieve.
 * Uses the configured OpenAI-compatible / Ollama provider when semantic
 * index is on; otherwise a hashed bag-of-tokens stub so hybrid retrieve
 * still works without loading MiniLM twice.
 */
export function resolveMemoryEmbeddingPort(
  settings?: SemanticIndexSettings,
): MemoryEmbeddingPort {
  const backend = settings?.backend ?? settings?.source;
  if (
    settings?.enabled &&
    backend &&
    backend !== 'disabled' &&
    backend !== 'bundled'
  ) {
    try {
      return createMemoryEmbeddingPort(createHostEmbeddingProvider(settings));
    } catch {
      // Fall through to the hashed stub.
    }
  }
  return new HashMemoryEmbedding();
}
