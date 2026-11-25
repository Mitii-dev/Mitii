import type { MemoryFact, MemoryScope } from "../../contracts";
import { scopesCompatible } from "./scopes-compatible";

/** Port method: `MemoryStorePort.list`. */
export function inMemoryList(params: {
  facts: ReadonlyMap<string, MemoryFact>;
  scope?: MemoryScope;
}): readonly MemoryFact[] {
  const facts = [...params.facts.values()];
  return params.scope
    ? facts.filter((fact) => scopesCompatible(fact.scope, params.scope!))
    : facts;
}
