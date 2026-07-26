import type {
  AgentEngineRunCheckpointStorePort,
  AgentRunCheckpoint,
} from "../internal/RunCheckpoint";

/**
 * In-memory checkpoint store for tests and single-process hosts.
 */
export class InMemoryRunCheckpointStore
  implements AgentEngineRunCheckpointStorePort
{
  private readonly checkpoints = new Map<string, AgentRunCheckpoint>();

  public async save(checkpoint: AgentRunCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.runId, structuredClone(checkpoint));
  }

  public async load(
    runId: string,
  ): Promise<AgentRunCheckpoint | undefined> {
    const found = this.checkpoints.get(runId);
    return found ? structuredClone(found) : undefined;
  }

  public async delete(runId: string): Promise<void> {
    this.checkpoints.delete(runId);
  }
}
