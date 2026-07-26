import type { UiContribution } from '../../interfaces/ui';
import { ContributionRegistry } from './ContributionRegistry';

export class UiRegistry {
  private readonly registry = new ContributionRegistry<UiContribution>('UiRegistry');

  register(contribution: UiContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): UiContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly UiContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
