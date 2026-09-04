import type { ScoredSkill } from "./MatchSkills";

export function mergeSkillCandidates(
  required: readonly ScoredSkill[],
  matched: readonly ScoredSkill[],
): ScoredSkill[] {
  const requiredIds = new Set(required.map((entry) => entry.skill.id));
  const merged: ScoredSkill[] = [];
  const seen = new Set<string>();

  const push = (entry: ScoredSkill) => {
    if (seen.has(entry.skill.id)) {
      return;
    }
    seen.add(entry.skill.id);
    merged.push(entry);
  };

  for (const entry of matched) {
    if (entry.skill.alwaysApply) {
      push({
        ...entry,
        selection: entry.selection ?? "always_apply",
      });
    }
  }

  for (const entry of required) {
    push(entry);
  }

  for (const entry of matched) {
    if (entry.skill.alwaysApply || requiredIds.has(entry.skill.id)) {
      continue;
    }
    push({
      ...entry,
      selection: entry.selection ?? "matched",
    });
  }

  return merged;
}
