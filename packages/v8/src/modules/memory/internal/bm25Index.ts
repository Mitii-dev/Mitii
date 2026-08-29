import type { MemoryFact } from "../contracts";
import { MEMORY_THRESHOLDS } from "../policy";
import { getSynonyms } from "./synonyms";
import { tokenize, tokenizeQuery } from "./tokenize";

export interface Bm25Hit {
  id: string;
  score: number;
}

interface IndexEntry {
  id: string;
  termCount: number;
}

/**
 * In-process BM25 index over memory facts for one retrieve call.
 * Hosts may later persist a copy; the source of truth remains the fact store.
 */
export class MemoryBm25Index {
  private readonly entries = new Map<string, IndexEntry>();
  private readonly inverted = new Map<string, Set<string>>();
  private readonly docTermCounts = new Map<string, Map<string, number>>();
  private readonly identityTerms = new Map<string, Set<string>>();
  private totalDocLength = 0;
  private sortedTerms: string[] | null = null;

  public add(fact: MemoryFact): void {
    const terms = extractFactTerms(fact);
    const termFreq = new Map<string, number>();
    let termCount = 0;
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
      termCount += 1;
    }

    this.entries.set(fact.id, { id: fact.id, termCount });
    this.docTermCounts.set(fact.id, termFreq);
    this.identityTerms.set(fact.id, new Set(extractIdentityTerms(fact)));
    this.totalDocLength += termCount;

    for (const term of termFreq.keys()) {
      const posting = this.inverted.get(term) ?? new Set<string>();
      posting.add(fact.id);
      this.inverted.set(term, posting);
    }
    this.sortedTerms = null;
  }

  public search(query: string, limit: number): Bm25Hit[] {
    const rawTerms = tokenizeQuery(query);
    if (rawTerms.length === 0 || this.entries.size === 0) {
      return [];
    }

    const documentCount = this.entries.size;
    const avgDocLen = this.totalDocLength / documentCount;
    const queryTerms = expandQueryTerms(rawTerms);
    const scores = new Map<string, number>();
    const covered = new Map<string, Set<string>>();
    const identityHits = new Set<string>();
    const sorted = this.getSortedTerms();
    const { bm25K1: k1, bm25B: b, prefixIdfScale, minPrefixTermLength } =
      MEMORY_THRESHOLDS;

    for (const { term, weight, source } of queryTerms) {
      const matching = this.inverted.get(term);
      if (matching) {
        const df = matching.size;
        const idf = Math.log((documentCount - df + 0.5) / (df + 0.5) + 1);
        for (const id of matching) {
          const sources = covered.get(id) ?? new Set<string>();
          sources.add(source);
          covered.set(id, sources);
          if (this.identityTerms.get(id)?.has(term)) {
            identityHits.add(id);
          }
          scores.set(
            id,
            (scores.get(id) ?? 0) +
              bm25Contribution({
                tf: this.docTermCounts.get(id)?.get(term) ?? 0,
                docLen: this.entries.get(id)?.termCount ?? 1,
                avgDocLen,
                k1,
                b,
                idf,
                weight,
              }),
          );
        }
      }

      if (term.length < minPrefixTermLength) {
        continue;
      }
      const start = lowerBound(sorted, term);
      for (let index = start; index < sorted.length; index += 1) {
        const indexedTerm = sorted[index];
        if (!indexedTerm.startsWith(term)) {
          break;
        }
        if (indexedTerm === term) {
          continue;
        }
        const obsIds = this.inverted.get(indexedTerm);
        if (!obsIds) {
          continue;
        }
        const prefixDf = obsIds.size;
        const prefixIdf =
          Math.log((documentCount - prefixDf + 0.5) / (prefixDf + 0.5) + 1) *
          prefixIdfScale;
        for (const id of obsIds) {
          scores.set(
            id,
            (scores.get(id) ?? 0) +
              bm25Contribution({
                tf: this.docTermCounts.get(id)?.get(indexedTerm) ?? 0,
                docLen: this.entries.get(id)?.termCount ?? 1,
                avgDocLen,
                k1,
                b,
                idf: prefixIdf,
                weight,
              }),
          );
        }
      }
    }

    const minCovered = Math.min(
      MEMORY_THRESHOLDS.minCoveredQueryTerms,
      new Set(rawTerms).size,
    );

    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((left, right) => right.score - left.score)
      .filter((hit) => {
        const coveredCount = covered.get(hit.id)?.size ?? 0;
        if (coveredCount >= minCovered) {
          return true;
        }
        return coveredCount >= 1 && identityHits.has(hit.id);
      })
      .filter((hit, _, remaining) => {
        const peak = remaining[0]?.score ?? 0;
        return peak <= 0 || hit.score >= peak * MEMORY_THRESHOLDS.bm25RelativeFloor;
      })
      .slice(0, limit);
  }

  private getSortedTerms(): string[] {
    if (!this.sortedTerms) {
      this.sortedTerms = [...this.inverted.keys()].sort();
    }
    return this.sortedTerms;
  }
}

export function extractIdentityTerms(fact: MemoryFact): string[] {
  const concepts = fact.concepts.length > 0 ? fact.concepts : fact.tags;
  const terms = tokenize(
    [fact.title ?? "", fact.type, ...concepts, ...fact.tags]
      .filter(Boolean)
      .join(" "),
  );
  for (const file of fact.files) {
    terms.push(...tokenizePath(file));
  }
  return terms;
}

export function extractFactTerms(fact: MemoryFact): string[] {
  const concepts = fact.concepts.length > 0 ? fact.concepts : fact.tags;
  const weighted = [
    fact.title ?? "",
    fact.title ?? "",
    fact.type,
    fact.type,
    ...concepts,
    ...concepts,
    ...fact.tags,
    ...fact.tags,
  ];
  const terms = tokenize(weighted.filter(Boolean).join(" "));
  terms.push(...tokenize(fact.content));
  for (const file of fact.files) {
    const pathTerms = tokenizePath(file);
    terms.push(...pathTerms, ...pathTerms);
  }
  return terms;
}

export function tokenizePath(path: string): string[] {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const terms = tokenize(normalized);
  for (const segment of normalized.split("/")) {
    if (segment.length === 0) {
      continue;
    }
    terms.push(...tokenize(segment));
    const withoutExt = segment.replace(/\.[^.]+$/, "");
    if (withoutExt !== segment) {
      terms.push(...tokenize(withoutExt));
    }
  }
  return terms;
}

function expandQueryTerms(
  rawTerms: readonly string[],
): Array<{ term: string; weight: number; source: string }> {
  const queryTerms: Array<{ term: string; weight: number; source: string }> =
    [];
  const seen = new Set<string>();
  for (const term of rawTerms) {
    if (!seen.has(term)) {
      seen.add(term);
      queryTerms.push({ term, weight: 1, source: term });
    }
    for (const synonym of getSynonyms(term)) {
      if (!seen.has(synonym)) {
        seen.add(synonym);
        queryTerms.push({
          term: synonym,
          weight: MEMORY_THRESHOLDS.synonymWeight,
          source: term,
        });
      }
    }
  }
  return queryTerms;
}

function bm25Contribution(params: {
  tf: number;
  docLen: number;
  avgDocLen: number;
  k1: number;
  b: number;
  idf: number;
  weight: number;
}): number {
  const numerator = params.tf * (params.k1 + 1);
  const denominator =
    params.tf +
    params.k1 *
      (1 - params.b + params.b * (params.docLen / Math.max(params.avgDocLen, 1)));
  return params.idf * (numerator / Math.max(denominator, 1e-9)) * params.weight;
}

function lowerBound(values: readonly string[], target: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((values[mid] ?? "") < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
