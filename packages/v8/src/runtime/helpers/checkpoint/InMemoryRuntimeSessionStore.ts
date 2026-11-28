import type {
  RuntimeSessionCarry,
  RuntimeSessionStorePort,
} from "./RuntimeSessionCarry";

/** Process-local session carry — default until host checkpoint store evacuates. */
export class InMemoryRuntimeSessionStore implements RuntimeSessionStorePort {
  private readonly byRunId = new Map<string, RuntimeSessionCarry>();

  save(carry: RuntimeSessionCarry): void {
    this.byRunId.set(carry.runId, carry);
  }

  load(runId: string): RuntimeSessionCarry | undefined {
    return this.byRunId.get(runId);
  }
}
