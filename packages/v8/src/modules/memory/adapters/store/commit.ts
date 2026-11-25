import {
  memoryFactSchema,
  type MemoryFact,
} from "../../contracts";

/** Port method: `MemoryStorePort.commit`. */
export function inMemoryCommit(params: {
  facts: Map<string, MemoryFact>;
  fact: MemoryFact;
}): void {
  const parsed = memoryFactSchema.parse(params.fact);
  params.facts.set(parsed.id, parsed);
}
