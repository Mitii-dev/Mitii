/**
 * Boost fused retrieval candidates using published RepoMap importance.
 * Pure: no graph walk, no recompute of PageRank.
 */

/** Minimal shape from published RepoMap.entries — avoid deep imports. */
export interface RepoMapImportanceEntry {
  file: { relativePath: string };
  score: number;
}

export function importanceByPathFromRepoMapEntries(
  entries: readonly RepoMapImportanceEntry[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const path = entry.file.relativePath;
    const value = Math.max(0, entry.score);
    const previous = map.get(path) ?? 0;
    if (value > previous) map.set(path, value);
  }
  return map;
}

export interface ImportanceBoostableCandidate {
  relativePath: string;
  fusedScore: number;
  score: number;
  reasons: Array<{
    type: string;
    evidence: string;
  }>;
}

export interface BoostByImportanceResult<T extends ImportanceBoostableCandidate> {
  candidates: T[];
  boostedCount: number;
}

/**
 * Multiplicatively boost fusedScore by (1 + alpha * normalizedImportance).
 * Re-sorts by fusedScore desc. Alpha default 0.15 keeps RRF dominant.
 */
export function boostCandidatesByRepoMapImportance<
  T extends ImportanceBoostableCandidate,
>(params: {
  candidates: readonly T[];
  importanceByPath: ReadonlyMap<string, number>;
  /** Blend strength in [0, 1]. Default 0.15. */
  alpha?: number;
}): BoostByImportanceResult<T> {
  const alpha = clamp01(params.alpha ?? 0.15);
  if (params.candidates.length === 0 || params.importanceByPath.size === 0) {
    return { candidates: [...params.candidates], boostedCount: 0 };
  }

  let maxImportance = 0;
  for (const value of params.importanceByPath.values()) {
    if (value > maxImportance) maxImportance = value;
  }
  if (maxImportance <= 0) {
    return { candidates: [...params.candidates], boostedCount: 0 };
  }

  let boostedCount = 0;
  const next = params.candidates.map((candidate) => {
    const raw = params.importanceByPath.get(candidate.relativePath);
    if (raw === undefined || raw <= 0) {
      return { ...candidate };
    }
    const normalized = raw / maxImportance;
    const factor = 1 + alpha * normalized;
    const fusedScore = Math.min(1, candidate.fusedScore * factor);
    boostedCount += 1;
    return {
      ...candidate,
      fusedScore,
      score: fusedScore,
      reasons: [
        ...candidate.reasons,
        {
          type: "repo_map_importance_boost",
          evidence: `RepoMap importance boost ×${factor.toFixed(3)} (normalized=${normalized.toFixed(3)}) for ${candidate.relativePath}.`,
        },
      ],
    };
  });

  next.sort(
    (left, right) =>
      right.fusedScore - left.fusedScore ||
      left.relativePath.localeCompare(right.relativePath),
  );

  return { candidates: next, boostedCount };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
