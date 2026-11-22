import type { ScoredMemory } from "../actions/RetrieveMemory";

/** Apply diversity last. Exact bodies collapse; ordered bigrams preserve
 * directional statements while reducing repeated phrasing. */
export function diversifyMemory(rows: readonly ScoredMemory[], limit: number): ScoredMemory[] {
  const pool = [...rows].slice(0, 512);
  const selected: ScoredMemory[] = [];
  const sources = new Map<string, number>();
  const bodies = new Set<string>();
  while (pool.length && selected.length < limit) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const row = pool[i];
      const body = row.fact.content.trim().replace(/\s+/g, " ");
      const source = row.fact.sourceIds[0];
      if (bodies.has(body) || (source && (sources.get(source) ?? 0) >= 3)) continue;
      const redundancy = Math.max(0, ...selected.map(other => similarity(body, other.fact.content)));
      const score = selected.length ? 0.8 * row.score - 0.2 * redundancy : row.score;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    const [row] = pool.splice(best, 1);
    selected.push(row);
    bodies.add(row.fact.content.trim().replace(/\s+/g, " "));
    const source = row.fact.sourceIds[0];
    if (source) sources.set(source, (sources.get(source) ?? 0) + 1);
  }
  return selected;
}

function similarity(a: string, b: string): number {
  const shingles = (text: string) => {
    const words = text.toLowerCase().split(/\s+/);
    return new Set(words.slice(1).map((word, i) => `${words[i]} ${word}`));
  };
  const left = shingles(a), right = shingles(b);
  const intersection = [...left].filter(word => right.has(word)).length;
  return intersection / Math.max(1, left.size + right.size - intersection);
}
