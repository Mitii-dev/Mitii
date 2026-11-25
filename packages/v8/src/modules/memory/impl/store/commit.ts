import {
  memoryFactSchema,
  type MemoryFact,
} from "../../types";

/** Port method: `MemoryStorePort.commit`. */
export function inMemoryCommit(params: {
  facts: Map<string, MemoryFact>;
  fact: MemoryFact;
}): void {
  const parsed = memoryFactSchema.parse(params.fact);
  params.facts.set(parsed.id, parsed);
}
