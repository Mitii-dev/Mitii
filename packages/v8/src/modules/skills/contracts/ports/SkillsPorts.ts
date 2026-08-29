import type {
  SkillBody,
  SkillDescriptor,
  SkillIndexEntry,
} from "../output/SkillDescriptor";

/**
 * Host/application supplies the skill catalog. Skills never reads the
 * filesystem or marketplace directly.
 */
export interface SkillsCatalogPort {
  list():
    | Promise<readonly SkillIndexEntry[] | readonly SkillDescriptor[]>
    | readonly SkillIndexEntry[]
    | readonly SkillDescriptor[];
  loadBody?(id: string): Promise<SkillBody | undefined> | SkillBody | undefined;
}
