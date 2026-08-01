import type { MemoryFact, MemoryStorePort } from "../contracts";
import type { MemoryScope } from "../contracts";

/**
 * In-process memory store for tests and single-process hosts.
 */
export class InMemoryMemoryStore implements MemoryStorePort {
  private readonly facts = new Map<string, MemoryFact>();

  constructor(seed: readonly MemoryFact[] = []) {
    for (const fact of seed) {
      this.facts.set(fact.id, fact);
    }
  }

  public query(input: {
    scope: MemoryScope;
    query: string;
  }): readonly MemoryFact[] {
    void input.query;
    return [...this.facts.values()].filter((fact) =>
      scopesCompatible(fact.scope, input.scope),
    );
  }

  public commit(fact: MemoryFact): void {
    this.facts.set(fact.id, fact);
  }

  public list(): readonly MemoryFact[] {
    return [...this.facts.values()];
  }
}

function scopesCompatible(fact: MemoryScope, request: MemoryScope): boolean {
  if (fact.kind !== request.kind) {
    return false;
  }
  if (fact.kind === "user") {
    return fact.userId === request.userId;
  }
  if (fact.kind === "workspace") {
    return fact.workspaceId === request.workspaceId;
  }
  return fact.projectId === request.projectId;
}
