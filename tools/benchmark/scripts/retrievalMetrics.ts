// Pure metric functions for scoring HybridRetriever output against a
// hand-labeled set of expected relPaths. Binary relevance (a file either is
// or isn't one of the expected files for a query) — no graded relevance.

/** Fraction of expected files that appear anywhere in the top-K retrieved paths. */
export function recallAtK(retrievedPaths: string[], expectedPaths: string[], k: number): number {
  if (expectedPaths.length === 0) return 1;
  const topK = new Set(retrievedPaths.slice(0, k));
  const hits = expectedPaths.filter((p) => topK.has(p)).length;
  return hits / expectedPaths.length;
}

/**
 * Normalized Discounted Cumulative Gain over the top-K retrieved paths, with
 * binary relevance (1 if the path is expected, 0 otherwise).
 */
export function ndcgAtK(retrievedPaths: string[], expectedPaths: string[], k: number): number {
  if (expectedPaths.length === 0) return 1;
  const expectedSet = new Set(expectedPaths);

  let dcg = 0;
  for (let i = 0; i < Math.min(k, retrievedPaths.length); i++) {
    const relevance = expectedSet.has(retrievedPaths[i]) ? 1 : 0;
    dcg += relevance / Math.log2(i + 2);
  }

  const idealHits = Math.min(k, expectedPaths.length);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

/** Reciprocal rank of the first expected file found in the retrieved list (0 if none found). */
export function reciprocalRank(retrievedPaths: string[], expectedPaths: string[]): number {
  const expectedSet = new Set(expectedPaths);
  for (let i = 0; i < retrievedPaths.length; i++) {
    if (expectedSet.has(retrievedPaths[i])) return 1 / (i + 1);
  }
  return 0;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
