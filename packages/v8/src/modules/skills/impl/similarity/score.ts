import type { SkillIndexEntry } from "../../types";

/** Port method: `SkillSimilarityPort.score`. */
export function keywordSimilarityScore(
  query: string,
  skill: Pick<SkillIndexEntry, "id" | "title" | "description" | "tags">,
): number {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) {
    return 0;
  }
  const corpus = tokenize(
    [skill.title, skill.description ?? "", ...(skill.tags ?? [])].join(" "),
  );
  if (corpus.size === 0) {
    return 0;
  }
  let hits = 0;
  for (const token of queryTokens) {
    if (corpus.has(token)) {
      hits += 1;
    }
  }
  return Math.min(1, hits / Math.max(3, Math.min(queryTokens.size, 8)));
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_+.-]+/i)
      .filter((token) => token.length >= 2),
  );
}
