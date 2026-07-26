import type { FeatureModule } from '../../interfaces/feature';
import { ContributionRegistry } from './ContributionRegistry';

interface FeatureContribution {
  id: string;
  owner: string;
  module: FeatureModule;
}

export class FeatureRegistry {
  private readonly registry = new ContributionRegistry<FeatureContribution>('FeatureRegistry');

  register(module: FeatureModule): void {
    this.registry.register({
      id: module.manifest.id,
      owner: module.manifest.id,
      module,
    });
  }

  get(id: string): FeatureModule | undefined {
    return this.registry.get(id)?.module;
  }

  list(): readonly FeatureModule[] {
    return this.registry.list().map((entry) => entry.module);
  }

  resolveActivationOrder(): readonly FeatureModule[] {
    const modules = this.list();
    const byId = new Map(modules.map((module) => [module.manifest.id, module]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const ordered: FeatureModule[] = [];

    const visit = (module: FeatureModule): void => {
      const id = module.manifest.id;
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Cyclic feature dependency involving "${id}".`);
      }

      visiting.add(id);
      for (const dependency of module.manifest.requires ?? []) {
        const required = byId.get(dependency);
        if (!required) {
          throw new Error(`Feature "${id}" requires missing feature "${dependency}".`);
        }
        visit(required);
      }
      visiting.delete(id);
      visited.add(id);
      ordered.push(module);
    };

    for (const module of modules) visit(module);
    return ordered;
  }

  freeze(): void {
    this.registry.freeze();
  }
}
