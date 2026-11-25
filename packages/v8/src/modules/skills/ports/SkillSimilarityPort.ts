import type { SkillIndexEntry } from "../contracts/output/SkillDescriptor";

/**
 * Optional soft ranking signal for already-applicable skills.
 * Must never grant applicability alone — MatchSkills hard gates still apply.
 */
export interface SkillSimilarityPort {
  score(
    query: string,
    skill: Pick<SkillIndexEntry, "id" | "title" | "description" | "tags">,
  ): number | Promise<number>;
}
