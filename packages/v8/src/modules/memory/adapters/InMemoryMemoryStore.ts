import {
  memoryFactSchema,
  type MemoryFact,
  type MemoryFactDraft,
  type MemoryScope,
  type MemoryStorePort,
} from "../contracts";
import { inMemoryCommit } from "./store/commit";
import { inMemoryList } from "./store/list";
import { inMemoryQuery } from "./store/query";
import { inMemoryRecordAccess } from "./store/record-access";
import { inMemoryTransact } from "./store/transact";

/**
 * In-process memory store for tests and single-process hosts.
 * Port method bodies: flat `impl/store-*.ts` (same style as `flow/`).
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
    return inMemoryQuery({
      facts: this.facts,
      scope: input.scope,
      query: input.query,
    });
  }

  public commit(fact: MemoryFact): void {
    inMemoryCommit({ facts: this.facts, fact });
  }

  public transact<T>(
    scope: MemoryScope,
    decide: (facts: readonly MemoryFact[]) => {
      facts: readonly MemoryFact[];
      result: T;
    },
  ): T {
    return inMemoryTransact({ facts: this.facts, scope, decide });
  }

  public list(scope?: MemoryScope): readonly MemoryFact[] {
    return inMemoryList({ facts: this.facts, scope });
  }

  public recordAccess(ids: readonly string[], at: string): void {
    inMemoryRecordAccess({ facts: this.facts, ids, at });
  }
}
