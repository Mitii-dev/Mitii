import type { ContextEpoch, ContextEpochStorePort } from "./types";

/** Process-local epoch store for tests and hosts without durable persistence. */
export class InMemoryContextEpochStore implements ContextEpochStorePort {
  private readonly epochs = new Map<string, ContextEpoch>();

  public async load(runId: string): Promise<ContextEpoch | undefined> {
    return this.epochs.get(runId);
  }

  public async save(epoch: ContextEpoch): Promise<void> {
    this.epochs.set(epoch.runId, epoch);
  }

  public async delete(runId: string): Promise<void> {
    this.epochs.delete(runId);
  }
}
