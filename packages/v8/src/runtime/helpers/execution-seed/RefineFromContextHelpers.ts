/** Shared path helpers for execution-seed context refine. */

export function queryTokens(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter(
      (token) =>
        ![
          "the",
          "and",
          "for",
          "with",
          "from",
          "that",
          "this",
          "should",
          "properly",
          "upon",
          "clicking",
          "its",
        ].includes(token),
    );
}

export function scorePath(path: string, tokens: readonly string[]): number {
  const lower = path.toLowerCase();
  const base = baseName(lower).replace(/\.[^.]+$/, "");
  let score = 0;
  for (const token of tokens) {
    if (base.includes(token) || lower.includes(token)) {
      score += token.length >= 5 ? 3 : 2;
    }
  }
  // Prefer renderer/UI surfaces for short UI asks when tokens match weakly.
  if (/\/renderer\//.test(lower) || /\.(tsx|jsx)$/.test(lower)) {
    score += 1;
  }
  return score;
}

export function normalize(value: string): string {
  let path = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (/^github\/workflows\//i.test(path)) {
    path = `.github/${path.slice("github/".length)}`;
  }
  return path;
}

export function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function uniqueCap(values: readonly string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export function samePathSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right.map((path) => path.toLowerCase()));
  return left.every((path) => rightSet.has(path.toLowerCase()));
}
