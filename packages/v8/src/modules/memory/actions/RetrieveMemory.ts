import type {
  MemoryEmbeddingPort,
  MemoryFact,
  MemoryOmission,
  MemoryScope,
} from "../contracts";
import { DEFAULT_CHARACTERS_PER_TOKEN } from "../defaults";
import { MemoryBm25Index } from "../internal/bm25Index";
import { extractEntitiesFromQuery } from "../internal/extractEntities";
import { rankFactsByFileTargets } from "../internal/fileMatch";
import { diversifyBySource, fuseRankedStreams } from "../internal/hybridFuse";
import { scoreMemoryRetention } from "../internal/retention";
import { MemoryVectorIndex } from "../internal/vectorIndex";
import { MEMORY_THRESHOLDS } from "../policy";

export interface ScoredMemory {
  fact: MemoryFact;
  score: number;
  streams: readonly string[];
}

export function filterMemoryCandidates(params: {
  facts: readonly MemoryFact[];
  scope: MemoryScope;
  requesterUserId?: string;
  now: Date;
}): {
  candidates: MemoryFact[];
  omissions: MemoryOmission[];
  staleFiltered: boolean;
  privacyFiltered: boolean;
  supersededFiltered: boolean;
} {
  const omissions: MemoryOmission[] = [];
  const candidates: MemoryFact[] = [];
  let staleFiltered = false;
  let privacyFiltered = false;
  let supersededFiltered = false;

  for (const fact of params.facts) {
    if (!scopesCompatible(fact.scope, params.scope)) {
      omissions.push({ memoryId: fact.id, reason: "scope_mismatch" });
      continue;
    }

    if (fact.isLatest === false) {
      omissions.push({ memoryId: fact.id, reason: "superseded" });
      supersededFiltered = true;
      continue;
    }

    if (fact.expiresAt && new Date(fact.expiresAt).getTime() <= params.now.getTime()) {
      omissions.push({ memoryId: fact.id, reason: "stale" });
      staleFiltered = true;
      continue;
    }

    if (
      fact.privacy === "private" &&
      fact.scope.userId &&
      params.requesterUserId &&
      fact.scope.userId !== params.requesterUserId
    ) {
      omissions.push({ memoryId: fact.id, reason: "privacy" });
      privacyFiltered = true;
      continue;
    }

    if (!fact.content.trim()) {
      continue;
    }

    candidates.push(fact);
  }

  return {
    candidates,
    omissions,
    staleFiltered,
    privacyFiltered,
    supersededFiltered,
  };
}

export async function scoreMemoryRelevance(params: {
  facts: readonly MemoryFact[];
  query: string;
  fileTargets?: readonly string[];
  concepts?: readonly string[];
  maxFacts: number;
  now: Date;
  embedding?: MemoryEmbeddingPort;
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

  const diversified = diversifyBySource(
    fused,
    (id) => {
      const fact = byId.get(id);
      if (!fact) {
        return id;
      }
      return fact.sourceIds[0] ?? fact.source ?? id;
    },
    retrieveDepth,
  );

  const scored: ScoredMemory[] = [];
  for (const hit of diversified) {
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
    scored,
    fileBoosted: scored.some((entry) => entry.streams.includes("file")),
    hybrid: scored.some((entry) => entry.streams.includes("vector")),
    embeddingWarning: vector.warning,
  };
}

async function searchVectorHits(params: {
  facts: readonly MemoryFact[];
  query: string;
  limit: number;
  embedding?: MemoryEmbeddingPort;
}): Promise<{ ids: string[]; warning?: string }> {
  if (!params.embedding || params.facts.length === 0) {
    return { ids: [] };
  }
  try {
    const queryVector = await params.embedding.embed(
      params.query.slice(0, MEMORY_THRESHOLDS.embedMaxChars),
    );
    if (queryVector.length !== params.embedding.dimensions) {
      return {
        ids: [],
        warning: "Memory embedding query dimension mismatch; using BM25 only.",
      };
    }
    const index = new MemoryVectorIndex();
    for (const fact of params.facts) {
      const text = [fact.title ?? "", fact.content, ...fact.concepts, ...fact.files]
        .filter(Boolean)
        .join(" ")
        .slice(0, MEMORY_THRESHOLDS.embedMaxChars);
      const embedding = await params.embedding.embed(text);
      if (embedding.length !== params.embedding.dimensions) {
        continue;
      }
      index.add(fact.id, embedding);
    }
    return {
      ids: index
        .search(queryVector, params.limit)
        .filter((hit) => hit.score >= MEMORY_THRESHOLDS.vectorMinScore)
        .map((hit) => hit.id),
    };
  } catch (error) {
    return {
      ids: [],
      warning: `Memory embedding failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function applyMemoryBudget(params: {
  scored: readonly ScoredMemory[];
  budgetTokens: number;
  maxFacts: number;
}): {
  instructions: Array<{
    id: string;
    title?: string;
    content: string;
    priority: number;
    provenance: {
      memoryId: string;
      source: "memory";
      scopeKind: "user" | "workspace" | "project";
      score: number;
      privacy: "private" | "shareable";
      createdAt: string;
    };
  }>;
  omissions: MemoryOmission[];
  usedTokens: number;
  budgetOmitted: boolean;
  irrelevantOmissions: MemoryOmission[];
} {
  const instructions: Array<{
    id: string;
    title?: string;
    content: string;
    priority: number;
    provenance: {
      memoryId: string;
      source: "memory";
      scopeKind: "user" | "workspace" | "project";
      score: number;
      privacy: "private" | "shareable";
      createdAt: string;
    };
  }> = [];
  const omissions: MemoryOmission[] = [];
  let usedTokens = 0;
  let remaining = params.budgetTokens;
  let budgetOmitted = false;

  for (const entry of params.scored) {
    if (instructions.length >= params.maxFacts) {
      omissions.push({
        memoryId: entry.fact.id,
        reason: "budget",
        tokens: estimateTokens(entry.fact.content),
      });
      budgetOmitted = true;
      continue;
    }

    const tokens = estimateTokens(entry.fact.content);
    if (tokens > remaining) {
      omissions.push({
        memoryId: entry.fact.id,
        reason: "budget",
        tokens,
      });
      budgetOmitted = true;
      continue;
    }

    const title =
      entry.fact.title ?? `Memory (${entry.fact.scope.kind})`;
    instructions.push({
      id: entry.fact.id,
      title,
      content: entry.fact.content.trim(),
      priority: Math.round(entry.score * 100),
      provenance: {
        memoryId: entry.fact.id,
        source: "memory",
        scopeKind: entry.fact.scope.kind,
        score: entry.score,
        privacy: entry.fact.privacy,
        createdAt: entry.fact.createdAt,
      },
    });
    usedTokens += tokens;
    remaining -= tokens;
  }

  return {
    instructions,
    omissions,
    usedTokens,
    budgetOmitted,
    irrelevantOmissions: [],
  };
}

export function estimateTokens(content: string): number {
  return Math.max(
    1,
    Math.ceil(content.length / DEFAULT_CHARACTERS_PER_TOKEN),
  );
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

function scopesCompatible(fact: MemoryScope, request: MemoryScope): boolean {
  if (fact.kind !== request.kind) {
    return false;
  }
  if (fact.kind === "user") {
    return fact.userId === request.userId;
  }
  if (fact.kind === "workspace") {
    return fact.workspaceId === request.workspaceId;
  }
  return fact.projectId === request.projectId;
}
