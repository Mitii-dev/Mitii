import type { LlmProviderContribution, ProviderFactoryContext, LlmProvider } from '../../interfaces/llm';
import { ContributionRegistry } from './ContributionRegistry';

export class ProviderRegistry {
  private readonly registry = new ContributionRegistry<LlmProviderContribution>('ProviderRegistry');

  register(contribution: LlmProviderContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): LlmProviderContribution | undefined {
    return this.registry.get(id);
  }

  create(id: string, context: ProviderFactoryContext): LlmProvider {
    const contribution = this.registry.get(id);
    if (!contribution) {
      throw new Error(`Unknown provider "${id}".`);
    }
    return contribution.create(context);
  }

  list(): readonly LlmProviderContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
