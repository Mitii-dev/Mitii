import type { MemoryOmission } from "../../contracts";
import { DEFAULT_CHARACTERS_PER_TOKEN } from "../../defaults";
import type { ScoredMemory } from "../../helpers/diversity";

/**
 * Flow step 3: pack ranked facts into the token / max-fact budget.
 */
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

    const title = entry.fact.title ?? `Memory (${entry.fact.scope.kind})`;
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
