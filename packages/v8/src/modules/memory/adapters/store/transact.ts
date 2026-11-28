import {
  memoryFactSchema,
  type MemoryFact,
  type MemoryScope,
} from "../../contracts";
import { inMemoryList } from "./list";
import { scopesCompatible } from "./scopes-compatible";

/** Port method: `MemoryStorePort.transact`. */
export function inMemoryTransact<T>(params: {
  facts: Map<string, MemoryFact>;
  scope: MemoryScope;
  decide: (facts: readonly MemoryFact[]) => {
    facts: readonly MemoryFact[];
    result: T;
  };
}): T {
  const decision = params.decide(
    inMemoryList({ facts: params.facts, scope: params.scope }).map((row) =>
      structuredClone(row),
    ),
  );
  const facts = memoryFactSchema.array().parse(decision.facts);
  for (const fact of facts) {
    if (!scopesCompatible(fact.scope, params.scope)) {
      throw new Error("Memory transaction scope mismatch.");
    }
  }
  for (const fact of facts) {
    params.facts.set(fact.id, fact);
  }
  return decision.result;
}
