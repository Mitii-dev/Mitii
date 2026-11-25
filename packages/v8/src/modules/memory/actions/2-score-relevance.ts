import { embedMemoryTexts } from "../internal/embeddingCache";
import {
  diversifyMemory,
  type ScoredMemory,
} from "../internal/diversity";
import type {
  MemoryEmbeddingPort,
  MemoryFact,
} from "../contracts";
import { MemoryBm25Index } from "../internal/bm25Index";
import { extractEntitiesFromQuery } from "../internal/extractEntities";
import { rankFactsByFileTargets } from "../internal/fileMatch";
import { fuseRankedStreams } from "../internal/hybridFuse";
import { scoreMemoryRetention } from "../internal/retention";
import { MemoryVectorIndex } from "../internal/vectorIndex";
import { MEMORY_MESSAGES } from "../constants";
import { MEMORY_THRESHOLDS } from "../policy";

export type { ScoredMemory };

/**
 * Flow step 2: BM25 + file + optional vector fusion, then retention mix.
 */
export async function scoreMemoryRelevance(params: {
  facts: readonly MemoryFact[];
  query: string;
  fileTargets?: readonly string[];
  concepts?: readonly string[];
  maxFacts: number;
  now: Date;
  embedding?: MemoryEmbeddingPort;
  signal?: AbortSignal;
}): Promise<{
  scored: ScoredMemory[];
  fileBoosted: boolean;
  hybrid: boolean;
  embeddingWarning?: string;
}> {
  const fileTargets = params.fileTargets ?? [];
  const extraConcepts = params.concepts ?? [];
  const byId = new Map(params.facts.map((fact) => [fact.id, fact]));

  const searchQuery = buildSearchQuery(
    params.query,
    fileTargets,
    extraConcepts,
  );

  const index = new MemoryBm25Index();
  for (const fact of params.facts) {
    index.add(fact);
  }

  const retrieveDepth = Math.max(params.maxFacts * 4, 20);
  const bm25Hits = index.search(searchQuery, retrieveDepth);
  const fileHits = rankFactsByFileTargets(params.facts, fileTargets);
  const vector = await searchVectorHits({
    facts: params.facts,
    query: searchQuery,
    limit: retrieveDepth,
    embedding: params.embedding,
    signal: params.signal,
  });

  const fused = fuseRankedStreams(
    [
      {
        id: "bm25",
        weight: MEMORY_THRESHOLDS.bm25StreamWeight,
        rankedIds: bm25Hits.map((hit) => hit.id),
      },
      {
        id: "file",
        weight: MEMORY_THRESHOLDS.fileStreamWeight,
        rankedIds: fileHits,
      },
      {
        id: "vector",
        weight: MEMORY_THRESHOLDS.vectorStreamWeight,
        rankedIds: vector.ids,
      },
    ],
    retrieveDepth,
  );

  const scored: ScoredMemory[] = [];
  for (const hit of fused) {
    const fact = byId.get(hit.id);
    if (!fact) {
      continue;
    }
    const retention = scoreMemoryRetention(fact, params.now);
    const mixed =
      hit.score * (1 - MEMORY_THRESHOLDS.retentionMix) +
      retention * MEMORY_THRESHOLDS.retentionMix;
    scored.push({
      fact,
      score: mixed,
      streams: hit.streams,
    });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.fact.importance !== left.fact.importance) {
      return right.fact.importance - left.fact.importance;
    }
    return right.fact.createdAt.localeCompare(left.fact.createdAt);
  });

  return {
    scored: diversifyMemory(scored, retrieveDepth),
    fileBoosted: scored.some((entry) => entry.streams.includes("file")),
    hybrid: scored.some((entry) => entry.streams.includes("vector")),
    embeddingWarning: vector.warning,
  };
}

export function buildSearchQuery(
  query: string,
  fileTargets: readonly string[],
  concepts: readonly string[],
): string {
  const extras = [
    ...fileTargets,
    ...concepts,
    ...extractEntitiesFromQuery(query),
  ].filter((value) => value.trim().length > 0);
  if (extras.length === 0) {
    return query;
  }
  return `${query} ${[...new Set(extras)].join(" ")}`;
}

async function searchVectorHits(params: {
  facts: readonly MemoryFact[];
  query: string;
  limit: number;
  embedding?: MemoryEmbeddingPort;
  signal?: AbortSignal;
}): Promise<{ ids: string[]; warning?: string }> {
  if (!params.embedding || params.facts.length === 0) {
    return { ids: [] };
  }
  try {
    const texts = [
      params.query,
      ...params.facts.map((fact) =>
        [fact.title ?? "", fact.content, ...fact.concepts, ...fact.files]
          .filter(Boolean)
          .join(" "),
      ),
    ].map((text) => text.slice(0, MEMORY_THRESHOLDS.embedMaxChars));
    const [queryVector, ...vectors] = await embedMemoryTexts(
      params.embedding,
      texts,
      params.signal,
    );
    const index = new MemoryVectorIndex();
    params.facts.forEach((fact, i) => index.add(fact.id, vectors[i]));
    return {
      ids: index
        .search(queryVector, params.limit)
        .filter((hit) => hit.score >= MEMORY_THRESHOLDS.vectorMinScore)
        .map((hit) => hit.id),
    };
  } catch {
    params.signal?.throwIfAborted();
    return {
      ids: [],
      warning: MEMORY_MESSAGES.embeddingUnavailable,
    };
  }
}
