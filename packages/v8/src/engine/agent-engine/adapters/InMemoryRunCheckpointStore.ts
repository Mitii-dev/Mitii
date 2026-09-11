import {
  restorePointSchema,
  type RestorePoint,
  type RestorePointSummary,
} from "../contracts/output/RestorePoint";
import type {
  AgentEngineRunCheckpointStorePort,
  AgentRunCheckpoint,
} from "../internal/RunCheckpoint";

/**
 * In-memory checkpoint + restore-point store for tests and single-process hosts.
 */
export class InMemoryRunCheckpointStore
  implements AgentEngineRunCheckpointStorePort
{
  private readonly checkpoints = new Map<string, AgentRunCheckpoint>();
  private readonly restorePoints = new Map<string, Map<string, RestorePoint>>();

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
    this.restorePoints.delete(runId);
  }

  public async saveRestorePoint(point: RestorePoint): Promise<void> {
    const parsed = restorePointSchema.parse(point);
    let byRun = this.restorePoints.get(parsed.runId);
    if (!byRun) {
      byRun = new Map();
      this.restorePoints.set(parsed.runId, byRun);
    }
    byRun.set(parsed.restorePointId, structuredClone(parsed));
  }

  public async loadRestorePoint(
    runId: string,
    restorePointId: string,
  ): Promise<RestorePoint | undefined> {
    const found = this.restorePoints.get(runId)?.get(restorePointId);
    if (!found) {
      return undefined;
    }
    const parsed = restorePointSchema.safeParse(found);
    return parsed.success ? structuredClone(parsed.data) : undefined;
  }

  public async listRestorePoints(runId: string): Promise<RestorePointSummary[]> {
    const byRun = this.restorePoints.get(runId);
    if (!byRun) {
      return [];
    }
    const summaries: RestorePointSummary[] = [];
    for (const point of byRun.values()) {
      const parsed = restorePointSchema.safeParse(point);
      if (!parsed.success) {
        continue;
      }
      summaries.push({
        schemaVersion: 1,
        restorePointId: parsed.data.restorePointId,
        runId: parsed.data.runId,
        createdAt: parsed.data.createdAt,
        mutationCheckpointId: parsed.data.mutationSnapshot.checkpointId,
        changedFileCount: parsed.data.mutationSnapshot.files.length,
      });
    }
    summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return summaries;
  }

  public async deleteRestorePoints(runId: string): Promise<void> {
    this.restorePoints.delete(runId);
  }
}
