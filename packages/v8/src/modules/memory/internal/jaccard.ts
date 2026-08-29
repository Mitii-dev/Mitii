/**
 * Token Jaccard over words longer than two characters.
 * Used to decide whether a commit supersedes an existing latest fact.
 */
export function jaccardSimilarity(left: string, right: string): number {
  const setA = toTokenSet(left);
  const setB = toTokenSet(right);
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (setA.size + setB.size - intersection);
}

function toTokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
      .filter((token) => token.length > 2),
  );
}
