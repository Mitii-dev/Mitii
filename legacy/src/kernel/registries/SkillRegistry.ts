import type { SkillContribution } from '../../interfaces/skills';
import { ContributionRegistry } from './ContributionRegistry';

export class SkillRegistry {
  private readonly registry = new ContributionRegistry<SkillContribution>('SkillRegistry');

  register(contribution: SkillContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): SkillContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly SkillContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
