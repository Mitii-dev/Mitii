import type { McpContribution } from '../../interfaces/mcp';
import { ContributionRegistry } from './ContributionRegistry';

export class McpRegistry {
  private readonly registry = new ContributionRegistry<McpContribution>('McpRegistry');

  register(contribution: McpContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): McpContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly McpContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
