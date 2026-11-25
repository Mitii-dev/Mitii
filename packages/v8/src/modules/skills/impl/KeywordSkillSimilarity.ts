import type { SkillIndexEntry } from "../types";
import type { SkillSimilarityPort } from "../ports/SkillSimilarityPort";
import { keywordSimilarityScore } from "./similarity/score";

/**
 * Default similarity adapter: token overlap against title/description/tags.
 * Port method body: `impl/similarity-score.ts`.
 */
export class KeywordSkillSimilarity implements SkillSimilarityPort {
  public score(
    query: string,
    skill: Pick<SkillIndexEntry, "id" | "title" | "description" | "tags">,
  ): number {
    return keywordSimilarityScore(query, skill);
  }
}
