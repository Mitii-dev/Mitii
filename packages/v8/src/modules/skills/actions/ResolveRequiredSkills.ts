import type { SkillIndexEntry, SkillOmission } from "../contracts";
import { normalizeSkillId } from "../parseRequiredSkillMentions";

import type { ScoredSkill } from "./MatchSkills";

export function resolveRequiredSkills(params: {
  catalog: readonly SkillIndexEntry[];
  requiredSkillIds: readonly string[];
}): {
  scored: ScoredSkill[];
  omissions: SkillOmission[];
  resolvedIds: string[];
} {
  const scored: ScoredSkill[] = [];
  const omissions: SkillOmission[] = [];
  const resolvedIds: string[] = [];
  const seen = new Set<string>();

  for (const raw of params.requiredSkillIds) {
    const id = normalizeSkillId(raw);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const skill = params.catalog.find((entry) => entry.id === id);
    if (!skill) {
      omissions.push({ skillId: id, reason: "not_found" });
      continue;
    }

    resolvedIds.push(id);
    scored.push({
      skill,
      score: 1,
      reasons: ["required"],
      selection: "required",
    });
  }

  return { scored, omissions, resolvedIds };
}
