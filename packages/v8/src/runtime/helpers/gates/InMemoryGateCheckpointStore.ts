import type {
  GateCheckpointStorePort,
  RuntimeGateCheckpoint,
} from "./types";

/** Process-local gate checkpoint — default until host Store evacuate. */
export class InMemoryGateCheckpointStore implements GateCheckpointStorePort {
  private readonly byRunId = new Map<string, RuntimeGateCheckpoint>();

  async save(checkpoint: RuntimeGateCheckpoint): Promise<void> {
    this.byRunId.set(checkpoint.runId, checkpoint);
  }

  async load(runId: string): Promise<RuntimeGateCheckpoint | undefined> {
    return this.byRunId.get(runId);
  }
}
