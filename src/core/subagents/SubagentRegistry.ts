import { BUILTIN_SUBAGENTS } from './SubagentDefinition';
import type { SubagentDefinition, SubagentType } from './types';

export class SubagentRegistry {
  private readonly definitions = new Map<string, SubagentDefinition>();

  constructor(definitions: SubagentDefinition[] = BUILTIN_SUBAGENTS) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: SubagentDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  get(type: SubagentType): SubagentDefinition | undefined {
    return this.definitions.get(type);
  }

  list(): SubagentDefinition[] {
    return [...this.definitions.values()];
  }

  merge(definitions: SubagentDefinition[]): void {
    for (const definition of definitions) {
      this.register(definition);
    }
  }
}

export function createDefaultSubagentRegistry(extra: SubagentDefinition[] = []): SubagentRegistry {
  const registry = new SubagentRegistry();
  registry.merge(extra);
  return registry;
}
