import type { SkillDescriptor, SkillsCatalogPort } from "../contracts";

/**
 * In-process skill catalog for tests and single-process hosts.
 */
export class InMemorySkillsCatalog implements SkillsCatalogPort {
  private readonly skills: SkillDescriptor[];

  constructor(skills: readonly SkillDescriptor[] = []) {
    this.skills = [...skills];
  }

  public list(): readonly SkillDescriptor[] {
    return this.skills;
  }

  public replace(skills: readonly SkillDescriptor[]): void {
    this.skills.splice(0, this.skills.length, ...skills);
  }
}
