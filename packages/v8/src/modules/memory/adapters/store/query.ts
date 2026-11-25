import type { MemoryFact, MemoryScope } from "../../contracts";
import { scopesCompatible } from "./scopes-compatible";

/** Port method: `MemoryStorePort.query`. */
export function inMemoryQuery(params: {
  facts: ReadonlyMap<string, MemoryFact>;
  scope: MemoryScope;
  query: string;
}): readonly MemoryFact[] {
  void params.query;
  return [...params.facts.values()].filter((fact) =>
    scopesCompatible(fact.scope, params.scope),
  );
}
