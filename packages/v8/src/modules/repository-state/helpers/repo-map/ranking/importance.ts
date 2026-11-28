/**
 * Importance contracts for published RepoMap ranking.
 *
 * PageRank is computed in repository-state (RepoMapRanker).
 * repository-context may only *apply* these scores — never recompute
 * graph PageRank.
 */

export type ImportanceSource = "page_rank";

/**
 * Normalized importance for one map entity (usually a file id or path key).
 * `score` is ≥ 0 (raw PageRank mass or derived composite).
 */
export interface ImportanceScore {
  /** Stable key (file id, or `rootId:relativePath`). */
  entityId: string;
  relativePath?: string;
  symbolName?: string;
  score: number;
  source: ImportanceSource;
}

export type ImportanceScoreMap = ReadonlyMap<string, number>;

/**
 * Convert a PageRank score map into ImportanceScore rows.
 * Does not normalize; callers may scale as needed.
 */
export function toImportanceScores(
  pageRank: ReadonlyMap<string, number>,
  options?: {
    relativePathByEntityId?: ReadonlyMap<string, string>;
  },
): ImportanceScore[] {
  const rows: ImportanceScore[] = [];
  for (const [entityId, score] of pageRank) {
    if (!Number.isFinite(score) || score < 0) continue;
    const relativePath =
      options?.relativePathByEntityId?.get(entityId);
    rows.push({
      entityId,
      ...(relativePath ? { relativePath } : {}),
      score,
      source: "page_rank",
    });
  }
  return rows.sort((a, b) => b.score - a.score || a.entityId.localeCompare(b.entityId));
}

/**
 * Build a path → importance lookup from published RepoMap entries.
 */
export function importanceByRelativePathFromRepoMap(entries: readonly {
  file: { relativePath: string };
  pageRank: number;
  score: number;
}[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const path = entry.file.relativePath;
    // Prefer composite map score (already includes PageRank + signals).
    const value = Math.max(0, entry.score);
    const previous = map.get(path) ?? 0;
    if (value > previous) map.set(path, value);
  }
  return map;
}
