import type { CommandContribution } from '../../interfaces/commands';
import { ContributionRegistry } from './ContributionRegistry';

export class CommandRegistry {
  private readonly registry = new ContributionRegistry<CommandContribution>('CommandRegistry');

  register(contribution: CommandContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): CommandContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly CommandContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
