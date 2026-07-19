import type { ContextSourceContribution } from '../../interfaces/context';
import { ContributionRegistry } from './ContributionRegistry';

export class ContextSourceRegistry {
  private readonly registry = new ContributionRegistry<ContextSourceContribution>('ContextSourceRegistry');

  register(contribution: ContextSourceContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): ContextSourceContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly ContextSourceContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
