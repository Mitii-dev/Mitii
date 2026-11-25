import type { MemoryFact } from "../../contracts";
import { applyAccessTouch } from "../../helpers/retention";

/** Port method: `MemoryStorePort.recordAccess`. */
export function inMemoryRecordAccess(params: {
  facts: Map<string, MemoryFact>;
  ids: readonly string[];
  at: string;
}): void {
  for (const id of params.ids) {
    const existing = params.facts.get(id);
    if (!existing) {
      continue;
    }
    params.facts.set(id, applyAccessTouch(existing, params.at));
  }
}
