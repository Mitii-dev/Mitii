import type { ContextItem, ContextQuery } from './types';
import type { ContextSource } from './types';
import type { ContextReranker } from './ContextReranker';
import { createLogger } from '../telemetry/Logger';

const log = createLogger('HybridRetriever');

const SOURCE_TIMEOUT_MS = 800;

/** Fast explicit sources first; heavy search sources in parallel tier 2. */
const SOURCE_TIERS: string[][] = [
  ['project-rules', 'mentioned-files', 'skill-catalog'],
  ['workspace-overview', 'current-editor', 'open-files', 'git-diff', 'diagnostics'],
  ['fts', 'indexed-file-search', 'vector', 'repo-map', 'memory'],
];

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
    const sourceById = new Map(this.sources.map((s) => [s.id, s]));
    const orderedSources: ContextSource[] = [];
    const seen = new Set<string>();

    for (const tier of SOURCE_TIERS) {
      for (const id of tier) {
        const source = sourceById.get(id);
        if (source && !seen.has(id)) {
          orderedSources.push(source);
          seen.add(id);
        }
      }
    }
    for (const source of this.sources) {
      if (!seen.has(source.id)) {
        orderedSources.push(source);
      }
    }

    const allItems: ContextItem[] = [];
    for (const tierSources of chunkByTier(orderedSources)) {
      const tierResults = await Promise.allSettled(
        tierSources.map((source) => retrieveWithTimeout(source, query, SOURCE_TIMEOUT_MS))
      );

      for (let i = 0; i < tierResults.length; i++) {
        const result = tierResults[i];
        const source = tierSources[i];
        if (result.status === 'fulfilled') {
          allItems.push(...result.value);
        } else {
          log.warn('Context source failed', {
            source: source.id,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
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

function chunkByTier(sources: ContextSource[]): ContextSource[][] {
  const tiers: ContextSource[][] = [];
  let currentTier = -1;
  let bucket: ContextSource[] = [];

  for (const source of sources) {
    const tierIdx = SOURCE_TIERS.findIndex((tier) => tier.includes(source.id));
    const tier = tierIdx >= 0 ? tierIdx : SOURCE_TIERS.length;
    if (tier !== currentTier) {
      if (bucket.length > 0) tiers.push(bucket);
      bucket = [source];
      currentTier = tier;
    } else {
      bucket.push(source);
    }
  }
  if (bucket.length > 0) tiers.push(bucket);
  return tiers;
}

async function retrieveWithTimeout(
  source: ContextSource,
  query: ContextQuery,
  timeoutMs: number
): Promise<ContextItem[]> {
  return new Promise<ContextItem[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    source.retrieve(query)
      .then((items) => {
        clearTimeout(timer);
        resolve(items);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
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
