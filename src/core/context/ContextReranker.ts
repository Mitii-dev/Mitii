import type { ContextItem } from './types';
import { cosineSimilarity, type EmbeddingProvider } from '../indexing/EmbeddingProvider';
import { createLogger } from '../telemetry/Logger';

const log = createLogger('ContextReranker');

export interface ContextReranker {
  rerank(query: string, items: ContextItem[], limit: number): Promise<ContextItem[]>;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
}

/** Fast lexical overlap reranker — no model required. */
export class LexicalContextReranker implements ContextReranker {
  async rerank(query: string, items: ContextItem[], limit: number): Promise<ContextItem[]> {
    const terms = tokenize(query);
    if (terms.length === 0) return items.slice(0, limit);

    return items
      .map((item) => {
        const haystack = `${item.content}\n${item.relPath ?? ''}\n${item.reason}`.toLowerCase();
        const hits = terms.filter((t) => haystack.includes(t)).length;
        const lexical = hits / terms.length;
        const blended = item.score * 0.55 + lexical * 10 * 0.45;
        return { item, score: blended };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item, score }) => ({ ...item, score, reason: `${item.reason}; reranked` }));
  }
}

/** Cross-encoder-style reranker using the same local embedder as vector search. */
export class EmbeddingContextReranker implements ContextReranker {
  constructor(private readonly embedder: EmbeddingProvider) {}

  async rerank(query: string, items: ContextItem[], limit: number): Promise<ContextItem[]> {
    if (items.length === 0) return [];

    try {
      const texts = [query, ...items.map((i) => i.content.slice(0, 600))];
      const vectors = await this.embedder.embed(texts);
      const queryVec = vectors[0];
      if (!queryVec?.length) {
        return new LexicalContextReranker().rerank(query, items, limit);
      }

      return items
        .map((item, idx) => {
          const vec = vectors[idx + 1];
          const sim = vec?.length ? cosineSimilarity(queryVec, vec) : 0;
          const blended = item.score * 0.4 + sim * 10 * 0.6;
          return { item, score: blended };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ item, score }) => ({ ...item, score, reason: `${item.reason}; embedding-reranked` }));
    } catch (error) {
      log.warn('Embedding rerank failed, using lexical fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      return new LexicalContextReranker().rerank(query, items, limit);
    }
  }
}

export function createContextReranker(
  embedder?: EmbeddingProvider,
  useEmbeddingReranker = false
): ContextReranker {
  if (useEmbeddingReranker && embedder && embedder.id !== 'noop') {
    return new EmbeddingContextReranker(embedder);
  }
  return new LexicalContextReranker();
}
