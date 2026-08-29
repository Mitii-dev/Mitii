import {
  memoryFactSchema,
  type MemoryFact,
  type MemoryFactDraft,
  type MemoryScope,
  type MemoryStorePort,
} from "../contracts";
import { applyAccessTouch } from "../internal/retention";

/**
 * In-process memory store for tests and single-process hosts.
 */
export class InMemoryMemoryStore implements MemoryStorePort {
  private readonly facts = new Map<string, MemoryFact>();

  constructor(seed: readonly MemoryFactDraft[] = []) {
    for (const fact of seed) {
      const parsed = memoryFactSchema.parse(fact);
      this.facts.set(parsed.id, parsed);
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
    const parsed = memoryFactSchema.parse(fact);
    this.facts.set(parsed.id, parsed);
  }

  public list(scope?: MemoryScope): readonly MemoryFact[] {
    const facts = [...this.facts.values()];
    return scope
      ? facts.filter((fact) => scopesCompatible(fact.scope, scope))
      : facts;
  }

  public recordAccess(ids: readonly string[], at: string): void {
    for (const id of ids) {
      const existing = this.facts.get(id);
      if (!existing) {
        continue;
      }
      this.facts.set(id, applyAccessTouch(existing, at));
    }
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
