import type { SkillDescriptor } from "../output/SkillDescriptor";

/**
 * Host/application supplies the skill catalog. Skills never reads the
 * filesystem or marketplace directly.
 */
export interface SkillsCatalogPort {
  list(): Promise<readonly SkillDescriptor[]> | readonly SkillDescriptor[];
}
