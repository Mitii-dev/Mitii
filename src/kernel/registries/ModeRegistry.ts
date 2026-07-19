import type { ModeContribution } from '../../interfaces/modes';
import { ContributionRegistry } from './ContributionRegistry';

export class ModeRegistry {
  private readonly registry = new ContributionRegistry<ModeContribution>('ModeRegistry');

  register(contribution: ModeContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): ModeContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly ModeContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
