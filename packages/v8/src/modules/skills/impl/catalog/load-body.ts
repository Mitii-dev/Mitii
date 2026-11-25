import type { SkillBody, SkillDescriptor } from "../../types";

/** Port method: `SkillsCatalogPort.loadBody`. */
export function inMemoryCatalogLoadBody(
  skills: readonly SkillDescriptor[],
  id: string,
): SkillBody | undefined {
  const skill = skills.find((entry) => entry.id === id);
  if (!skill) {
    return undefined;
  }
  return {
    content: skill.content,
    resources: skill.resources,
  };
}
