import type { SkillDescriptor } from "../../types";

/** Port method: `SkillsCatalogPort.list`. */
export function inMemoryCatalogList(
  skills: readonly SkillDescriptor[],
): readonly SkillDescriptor[] {
  return skills;
}
