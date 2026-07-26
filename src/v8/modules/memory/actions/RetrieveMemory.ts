import type { MemoryFact, MemoryOmission, MemoryScope } from "../contracts";
import { DEFAULT_CHARACTERS_PER_TOKEN } from "../defaults";
import { MEMORY_THRESHOLDS } from "../policy";

export interface ScoredMemory {
  fact: MemoryFact;
  score: number;
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
} {
  const omissions: MemoryOmission[] = [];
  const candidates: MemoryFact[] = [];
  let staleFiltered = false;
  let privacyFiltered = false;

  for (const fact of params.facts) {
    if (!scopesCompatible(fact.scope, params.scope)) {
      omissions.push({ memoryId: fact.id, reason: "scope_mismatch" });
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

  return { candidates, omissions, staleFiltered, privacyFiltered };
}

export function scoreMemoryRelevance(params: {
  facts: readonly MemoryFact[];
  query: string;
}): ScoredMemory[] {
  const queryTokens = tokenize(params.query);
  const scored: ScoredMemory[] = [];

  for (const fact of params.facts) {
    const tagTokens = new Set(fact.tags.map((tag) => tag.toLowerCase()));
    const contentTokens = tokenize(fact.content);

    let tagHits = 0;
    for (const token of queryTokens) {
      if (tagTokens.has(token)) {
        tagHits += 1;
      }
    }
    const tagScore =
      tagTokens.size === 0
        ? 0
        : Math.min(1, tagHits / Math.max(1, tagTokens.size));

    let contentHits = 0;
    for (const token of queryTokens) {
      if (contentTokens.has(token)) {
        contentHits += 1;
      }
    }
    const contentScore =
      queryTokens.size === 0
        ? 0
        : Math.min(1, contentHits / Math.max(1, queryTokens.size));

    const score =
      MEMORY_THRESHOLDS.tagOverlapWeight * tagScore +
      MEMORY_THRESHOLDS.contentOverlapWeight * contentScore;

    if (score >= MEMORY_THRESHOLDS.minimumRelevanceScore) {
      scored.push({ fact, score });
    }
  }

  return scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.fact.createdAt.localeCompare(a.fact.createdAt);
  });
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

    instructions.push({
      id: entry.fact.id,
      title: `Memory (${entry.fact.scope.kind})`,
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

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_+.-]+/i)
      .filter((token) => token.length >= 2)
      .flatMap((token) => {
        const normalized = token.replace(/s$/i, "");
        return normalized.length >= 2 && normalized !== token
          ? [token, normalized]
          : [token];
      }),
  );
}
