import type { SettingsContribution } from '../../interfaces/config';
import { ContributionRegistry } from './ContributionRegistry';

export class SettingsRegistry {
  private readonly registry = new ContributionRegistry<SettingsContribution>('SettingsRegistry');

  register(contribution: SettingsContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): SettingsContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly SettingsContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
