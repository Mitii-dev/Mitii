import { MEMORY_THRESHOLDS } from "../policy";

export interface RankedStream {
  id: string;
  weight: number;
  rankedIds: readonly string[];
}

export interface FusedHit {
  id: string;
  score: number;
  streams: readonly string[];
}

/**
 * Reciprocal Rank Fusion across retrieve streams (BM25, file targets, …).
 * Empty streams are omitted and remaining weights are renormalized.
 */
export function fuseRankedStreams(
  streams: readonly RankedStream[],
  limit: number,
): FusedHit[] {
  const active = streams.filter((stream) => stream.rankedIds.length > 0);
  if (active.length === 0) {
    return [];
  }

  const totalWeight = active.reduce((sum, stream) => sum + stream.weight, 0);
  const ranks = new Map<
    string,
    { streams: string[]; score: number }
  >();

  for (const stream of active) {
    const weight = totalWeight > 0 ? stream.weight / totalWeight : 0;
    stream.rankedIds.forEach((id, index) => {
      const existing = ranks.get(id) ?? { streams: [], score: 0 };
      existing.score += weight / (MEMORY_THRESHOLDS.rrfK + index + 1);
      if (!existing.streams.includes(stream.id)) {
        existing.streams.push(stream.id);
      }
      ranks.set(id, existing);
    });
  }

  const maxScore = Math.max(0, ...[...ranks.values()].map((entry) => entry.score));

  return [...ranks.entries()]
    .map(([id, entry]) => ({
      id,
      score: maxScore > 0 ? entry.score / maxScore : 0,
      streams: entry.streams,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function diversifyBySource<T extends { id: string }>(
  ranked: readonly T[],
  sourceOf: (id: string) => string,
  limit: number,
  maxPerSource = MEMORY_THRESHOLDS.maxFactsPerSource,
): T[] {
  const selected: T[] = [];
  const counts = new Map<string, number>();

  for (const entry of ranked) {
    const source = sourceOf(entry.id);
    const count = counts.get(source) ?? 0;
    if (count >= maxPerSource) {
      continue;
    }
    selected.push(entry);
    counts.set(source, count + 1);
    if (selected.length >= limit) {
      return selected;
    }
  }

  if (selected.length < limit) {
    const chosen = new Set(selected.map((entry) => entry.id));
    for (const entry of ranked) {
      if (selected.length >= limit) {
        break;
      }
      if (!chosen.has(entry.id)) {
        selected.push(entry);
        chosen.add(entry.id);
      }
    }
  }

  return selected;
}
