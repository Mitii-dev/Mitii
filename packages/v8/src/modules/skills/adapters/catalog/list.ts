import type { SkillDescriptor } from "../../contracts";

/** Port method: `SkillsCatalogPort.list`. */
export function inMemoryCatalogList(
  skills: readonly SkillDescriptor[],
): readonly SkillDescriptor[] {
  return skills;
}
