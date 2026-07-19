import type { ToolFactoryContribution } from '../../interfaces/tools';
import { ContributionRegistry } from './ContributionRegistry';

export class ToolRegistry {
  private readonly registry = new ContributionRegistry<ToolFactoryContribution>('ToolRegistry');

  register(contribution: ToolFactoryContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): ToolFactoryContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly ToolFactoryContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
