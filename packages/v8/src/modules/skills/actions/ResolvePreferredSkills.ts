import type { SkillIndexEntry, SkillOmission } from "../contracts";
import { normalizeSkillId } from "../parseRequiredSkillMentions";

import type { ScoredSkill } from "./MatchSkills";

/**
 * Soft-prefer catalog skills by id. Includes them when present; never fails
 * the run when missing (unlike required skills).
 */
export function resolvePreferredSkills(params: {
  catalog: readonly SkillIndexEntry[];
  preferredSkillIds: readonly string[];
}): {
  scored: ScoredSkill[];
  resolvedIds: string[];
} {
  const scored: ScoredSkill[] = [];
  const resolvedIds: string[] = [];
  const seen = new Set<string>();

  for (const raw of params.preferredSkillIds) {
    const id = normalizeSkillId(raw);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const skill = params.catalog.find((entry) => entry.id === id);
    if (!skill) {
      continue;
    }

    resolvedIds.push(id);
    scored.push({
      skill,
      // High soft score so preferred wins conflictGroup vs weaker matches,
      // but below hard required (which merges first).
      score: 0.92,
      reasons: ["preferred"],
      selection: "preferred",
    });
  }

  return { scored, resolvedIds };
}

/** @deprecated kept so callers that typed omissions stay compiling if unused. */
export type PreferredSkillOmission = SkillOmission;
