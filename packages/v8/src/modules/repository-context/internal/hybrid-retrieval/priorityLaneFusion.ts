import { HYBRID_RETRIEVAL_DEFAULTS } from "./constants";

import type { WeightedReciprocalRankFusion } from "./WeightedReciprocalRankFusion";
import type {
  HybridRetrievalCandidate,
  NormalizedHybridRetrievalRequest,
  ResolvedHybridRetrieverOptions,
  SuccessfulRetrievalSourceResult,
} from "./types";

type FusionPort = Pick<WeightedReciprocalRankFusion, "fuse">;

export function hasSessionRankingContext(
  context: NormalizedHybridRetrievalRequest["rankingContext"],
): boolean {
  if (!context) {
    return false;
  }
  return Boolean(
    context.currentFile ||
      context.openFiles?.length ||
      context.gitDiffFiles?.length ||
      context.diagnosticFiles?.length ||
      context.recentEditFiles?.length ||
      context.staleFiles?.length ||
      context.priorityPaths?.length,
  );
}

/**
 * Priority paths (required / explicit / current selection) form a lane that
 * is fused separately and prepended ahead of the main RRF result so weak
 * lexical hits cannot bury user anchors.
 */
export function extractPriorityLane(
  fusion: FusionPort,
  options: Pick<ResolvedHybridRetrieverOptions, "rankConstant">,
  request: NormalizedHybridRetrievalRequest,
  successful: readonly SuccessfulRetrievalSourceResult[],
): {
  priorityCandidates: HybridRetrievalCandidate[];
  remainingSources: SuccessfulRetrievalSourceResult[];
} {
  const priorityPaths = new Set(
    (request.rankingContext?.priorityPaths ?? []).slice(
      0,
      HYBRID_RETRIEVAL_DEFAULTS.MAXIMUM_PRIORITY_PATHS,
    ),
  );

  if (priorityPaths.size === 0) {
    return {
      priorityCandidates: [],
      remainingSources: [...successful],
    };
  }

  const prioritySources: SuccessfulRetrievalSourceResult[] = [];
  const remainingSources: SuccessfulRetrievalSourceResult[] = [];

  for (const source of successful) {
    const priority: SuccessfulRetrievalSourceResult["candidates"][number][] =
      [];
    const remaining: SuccessfulRetrievalSourceResult["candidates"][number][] =
      [];
    for (const candidate of source.candidates) {
      if (priorityPaths.has(candidate.relativePath)) {
        priority.push(candidate);
      } else {
        remaining.push(candidate);
      }
    }
    if (priority.length > 0) {
      prioritySources.push({
        ...source,
        candidates: priority,
      });
    }
    remainingSources.push({
      ...source,
      candidates: remaining,
    });
  }

  if (prioritySources.length === 0) {
    return {
      priorityCandidates: [],
      remainingSources: [...successful],
    };
  }

  const priorityFusion = fusion.fuse({
    sourceResults: prioritySources,
    rankConstant: options.rankConstant,
    maximumResults: Math.max(
      priorityPaths.size,
      HYBRID_RETRIEVAL_DEFAULTS.MAXIMUM_PRIORITY_PATHS,
    ),
  });

  return {
    priorityCandidates: priorityFusion.candidates,
    remainingSources,
  };
}

export function mergePriorityLane(
  priority: readonly HybridRetrievalCandidate[],
  fused: readonly HybridRetrievalCandidate[],
  maximumResults: number,
): HybridRetrievalCandidate[] {
  if (priority.length === 0) {
    return [...fused];
  }

  const seen = new Set<string>();
  const merged: HybridRetrievalCandidate[] = [];

  for (const candidate of priority) {
    if (seen.has(candidate.key)) {
      continue;
    }
    seen.add(candidate.key);
    merged.push(candidate);
    if (merged.length >= maximumResults) {
      return merged;
    }
  }

  for (const candidate of fused) {
    if (seen.has(candidate.key)) {
      continue;
    }
    seen.add(candidate.key);
    merged.push(candidate);
    if (merged.length >= maximumResults) {
      break;
    }
  }

  return merged;
}
