import type { PolicyContribution } from '../../interfaces/policy';
import { ContributionRegistry } from './ContributionRegistry';

export class PolicyRegistry {
  private readonly registry = new ContributionRegistry<PolicyContribution>('PolicyRegistry');

  register(contribution: PolicyContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): PolicyContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly PolicyContribution[] {
    return [...this.registry.list()].sort((a, b) => b.priority - a.priority);
  }

  freeze(): void {
    this.registry.freeze();
  }
}
