import type { SkillOmission } from "../contracts";
import type { ScoredSkill } from "./MatchSkills";

/**
 * Keep at most one skill per conflictGroup (highest score/priority wins).
 */
export function resolveSkillConflicts(params: {
  scored: readonly ScoredSkill[];
}): {
  selected: ScoredSkill[];
  omissions: SkillOmission[];
  conflictsResolved: boolean;
} {
  const selected: ScoredSkill[] = [];
  const omissions: SkillOmission[] = [];
  const claimedGroups = new Set<string>();
  let conflictsResolved = false;

  for (const entry of params.scored) {
    const group = entry.skill.conflictGroup;
    if (group) {
      if (claimedGroups.has(group)) {
        omissions.push({
          skillId: entry.skill.id,
          reason: "conflict",
        });
        conflictsResolved = true;
        continue;
      }
      claimedGroups.add(group);
    }
    selected.push(entry);
  }

  return { selected, omissions, conflictsResolved };
}
