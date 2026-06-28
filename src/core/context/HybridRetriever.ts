import type { ContextItem, ContextQuery } from './types';
import type { ContextSource } from './types';
import type { ContextReranker } from './ContextReranker';
import { createLogger } from '../telemetry/Logger';

const log = createLogger('HybridRetriever');

export interface RerankerConfig {
  enabled: boolean;
  candidatePool: number;
  topK: number;
}

export class HybridRetriever {
  constructor(
    private readonly sources: ContextSource[],
    private readonly reranker?: ContextReranker,
    private readonly rerankerConfig?: RerankerConfig
  ) {}

  async retrieve(query: ContextQuery): Promise<ContextItem[]> {
    const allItems: ContextItem[] = [];

    for (const source of this.sources) {
      try {
        const items = await source.retrieve(query);
        allItems.push(...items);
      } catch (error) {
        log.warn('Context source failed', {
          source: source.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const deduped = deduplicateItems(allItems).sort((a, b) => b.score - a.score);

    if (this.reranker && this.rerankerConfig?.enabled) {
      const pool = deduped.slice(0, this.rerankerConfig.candidatePool);
      const reranked = await this.reranker.rerank(
        query.text,
        pool,
        this.rerankerConfig.topK
      );
      return reranked.slice(0, query.maxItems ?? this.rerankerConfig.topK);
    }

    return deduped.slice(0, query.maxItems ?? 30);
  }
}

function deduplicateItems(items: ContextItem[]): ContextItem[] {
  const seen = new Map<string, ContextItem>();

  for (const item of items) {
    const key = item.relPath
      ? `${item.relPath}:${item.startLine ?? 0}:${item.endLine ?? 0}`
      : item.id;

    const existing = seen.get(key);
    if (!existing || item.score > existing.score) {
      const merged: ContextItem = existing
        ? { ...item, score: Math.max(item.score, existing.score), reason: `${existing.reason}; ${item.reason}` }
        : item;
      seen.set(key, merged);
    }
  }

  return Array.from(seen.values());
}
