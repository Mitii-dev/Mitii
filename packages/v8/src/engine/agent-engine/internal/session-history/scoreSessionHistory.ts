import { SESSION_HISTORY_POLICY } from "./policy";
import type { SessionHistoryRecord } from "./types";

export interface RankedStream {
  readonly id: string;
  readonly weight: number;
  readonly rankedIds: readonly string[];
}

export interface FusedHit {
  readonly id: string;
  readonly score: number;
  readonly streams: readonly string[];
}

/**
 * Reciprocal Rank Fusion (same formula as memory hybridFuse / repo RRF).
 * Injected here to keep session-history self-contained inside agent-engine.
 */
export function fuseSessionHistoryStreams(
  streams: readonly RankedStream[],
  limit: number,
): FusedHit[] {
  const active = streams.filter((stream) => stream.rankedIds.length > 0);
  if (active.length === 0) {
    return [];
  }
  const totalWeight = active.reduce((sum, stream) => sum + stream.weight, 0);
  const ranks = new Map<string, { streams: string[]; score: number }>();

  for (const stream of active) {
    const weight = totalWeight > 0 ? stream.weight / totalWeight : 0;
    stream.rankedIds.forEach((id, index) => {
      const existing = ranks.get(id) ?? { streams: [], score: 0 };
      existing.score += weight / (SESSION_HISTORY_POLICY.rrfK + index + 1);
      if (!existing.streams.includes(stream.id)) {
        existing.streams.push(stream.id);
      }
      ranks.set(id, existing);
    });
  }

  const maxScore = Math.max(0, ...[...ranks.values()].map((e) => e.score));
  return [...ranks.entries()]
    .map(([id, entry]) => ({
      id,
      score: maxScore > 0 ? entry.score / maxScore : 0,
      streams: entry.streams,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function diversifySessionHistoryHits<T extends { id: string }>(
  ranked: readonly T[],
  sourceOf: (id: string) => string,
  limit: number,
  maxPerSource = SESSION_HISTORY_POLICY.maxPerSource,
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
    const chosen = new Set(selected.map((e) => e.id));
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

export function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 64);
}

/** Lexical overlap score (lightweight BM25-shaped: tf * idf-ish). */
export function scoreLexical(
  queryTokens: readonly string[],
  record: SessionHistoryRecord,
  docFreq: ReadonlyMap<string, number>,
  corpusSize: number,
): number {
  if (queryTokens.length === 0) {
    return 0;
  }
  const hay = `${record.content}\n${record.locators.join("\n")}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (!hay.includes(token)) {
      continue;
    }
    const tf = Math.min(8, countOccurrences(hay, token));
    const df = docFreq.get(token) ?? 1;
    const idf = Math.log(1 + corpusSize / df);
    score += ((tf * 2.2) / (tf + 1.2)) * idf;
  }
  return score;
}

export function scoreLocatorOverlap(
  queryTokens: readonly string[],
  record: SessionHistoryRecord,
): number {
  if (record.locators.length === 0 || queryTokens.length === 0) {
    return 0;
  }
  const locatorText = record.locators.join(" ").toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (locatorText.includes(token)) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}

export function buildDocFrequency(
  records: readonly SessionHistoryRecord[],
  queryTokens: readonly string[],
): Map<string, number> {
  const df = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const record of records) {
      const hay = `${record.content}\n${record.locators.join("\n")}`.toLowerCase();
      if (hay.includes(token)) {
        count += 1;
      }
    }
    df.set(token, Math.max(1, count));
  }
  return df;
}

function countOccurrences(hay: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (index < hay.length) {
    const found = hay.indexOf(needle, index);
    if (found < 0) {
      break;
    }
    count += 1;
    index = found + needle.length;
  }
  return count;
}
