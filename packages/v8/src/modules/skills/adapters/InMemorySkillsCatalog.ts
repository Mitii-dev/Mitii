import type { SkillDescriptor, SkillsCatalogPort } from "../contracts";
import { inMemoryCatalogList } from "./catalog/list";
import { inMemoryCatalogLoadBody } from "./catalog/load-body";

/**
 * In-process skill catalog for tests and single-process hosts.
 * Port method bodies: flat `impl/catalog-*.ts` (same style as `flow/`).
 */
export class InMemorySkillsCatalog implements SkillsCatalogPort {
  private readonly skills: SkillDescriptor[];

  constructor(skills: readonly SkillDescriptor[] = []) {
    this.skills = [...skills];
  }

  public list(): readonly SkillDescriptor[] {
    return inMemoryCatalogList(this.skills);
  }

  public loadBody(id: string) {
    return inMemoryCatalogLoadBody(this.skills, id);
  }

  public replace(skills: readonly SkillDescriptor[]): void {
    this.skills.splice(0, this.skills.length, ...skills);
  }
}
