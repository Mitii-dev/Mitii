import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_IDS,
  HYBRID_RETRIEVAL_MESSAGES,
} from "./constants";

import type {
  HybridRetrievalCandidate,
  HybridRetrievalWarning,
  SuccessfulRetrievalSourceResult,
} from "./types";

/**
 * Continue-style modality quotas: when vector retrieval is degraded, guarantee
 * minimum final slots for lexical / graph / map / session so RRF cannot starve
 * a whole modality.
 */
export function applyModalityQuotas(input: {
  candidates: readonly HybridRetrievalCandidate[];
  successful: readonly SuccessfulRetrievalSourceResult[];
  maximumResults: number;
}): {
  candidates: HybridRetrievalCandidate[];
  warning?: HybridRetrievalWarning;
} {
  const vectorAvailable = input.successful.some(
    (source) =>
      source.sourceId === HYBRID_RETRIEVAL_IDS.VECTOR_SOURCE &&
      source.candidates.length > 0,
  );

  if (vectorAvailable || input.candidates.length === 0) {
    return { candidates: [...input.candidates] };
  }

  const quotas: ReadonlyArray<{
    sourceId: string;
    fraction: number;
  }> = [
    {
      sourceId: HYBRID_RETRIEVAL_IDS.TEXT_SOURCE,
      fraction:
        HYBRID_RETRIEVAL_DEFAULTS.QUOTA_TEXT_WHEN_VECTOR_DEGRADED,
    },
    {
      sourceId: HYBRID_RETRIEVAL_IDS.REPO_GRAPH_SOURCE,
      fraction:
        HYBRID_RETRIEVAL_DEFAULTS.QUOTA_GRAPH_WHEN_VECTOR_DEGRADED,
    },
    {
      sourceId: HYBRID_RETRIEVAL_IDS.REPO_MAP_SOURCE,
      fraction:
        HYBRID_RETRIEVAL_DEFAULTS.QUOTA_MAP_WHEN_VECTOR_DEGRADED,
    },
    {
      sourceId: HYBRID_RETRIEVAL_IDS.SESSION_SOURCE,
      fraction:
        HYBRID_RETRIEVAL_DEFAULTS.QUOTA_SESSION_WHEN_VECTOR_DEGRADED,
    },
  ];

  const availableSourceIds = new Set(
    input.successful
      .filter((source) => source.candidates.length > 0)
      .map((source) => source.sourceId),
  );

  const byPrimarySource = new Map<string, HybridRetrievalCandidate[]>();
  for (const candidate of input.candidates) {
    const primary =
      primarySourceId(candidate) ?? HYBRID_RETRIEVAL_IDS.TEXT_SOURCE;
    const bucket = byPrimarySource.get(primary) ?? [];
    bucket.push(candidate);
    byPrimarySource.set(primary, bucket);
  }

  const selected: HybridRetrievalCandidate[] = [];
  const seen = new Set<string>();

  for (const quota of quotas) {
    if (!availableSourceIds.has(quota.sourceId)) {
      continue;
    }
    const slots = Math.max(
      1,
      Math.floor(input.maximumResults * quota.fraction),
    );
    const bucket = byPrimarySource.get(quota.sourceId) ?? [];
    let taken = 0;
    for (const candidate of bucket) {
      if (seen.has(candidate.key)) {
        continue;
      }
      seen.add(candidate.key);
      selected.push(candidate);
      taken += 1;
      if (taken >= slots) {
        break;
      }
    }
  }

  for (const candidate of input.candidates) {
    if (selected.length >= input.maximumResults) {
      break;
    }
    if (seen.has(candidate.key)) {
      continue;
    }
    seen.add(candidate.key);
    selected.push(candidate);
  }

  return {
    candidates: selected.slice(0, input.maximumResults),
    warning: {
      code: "modality_quota_applied",
      message: HYBRID_RETRIEVAL_MESSAGES.MODALITY_QUOTA_APPLIED,
    },
  };
}

function primarySourceId(
  candidate: HybridRetrievalCandidate,
): string | undefined {
  let best:
    | {
        sourceId: string;
        score: number;
      }
    | undefined;

  for (const contribution of candidate.contributions) {
    if (
      !best ||
      contribution.reciprocalRankScore > best.score
    ) {
      best = {
        sourceId: contribution.sourceId,
        score: contribution.reciprocalRankScore,
      };
    }
  }

  return best?.sourceId;
}
