import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AgentEngineRunCheckpointStorePort,
  AgentRunCheckpoint,
} from "../internal/RunCheckpoint";

const CHECKPOINT_FILE_SUFFIX = ".json";
const TEMP_FILE_SUFFIX = ".tmp";

/**
 * Durable run-checkpoint store under a host directory (typically
 * `<workspace>/.mitii/checkpoints/`).
 *
 * Writes are atomic (temp file + rename). Safe for VS Code reload and CLI
 * process restart so approval / clarification / plan resume survives.
 */
export class FileRunCheckpointStore
  implements AgentEngineRunCheckpointStorePort
{
  private readonly directory: string;

  constructor(directory: string) {
    const trimmed = directory.trim();
    if (!trimmed) {
      throw new Error("FileRunCheckpointStore requires a non-empty directory.");
    }
    this.directory = trimmed;
  }

  public async save(checkpoint: AgentRunCheckpoint): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(checkpoint.runId);
    const tempPath = `${path}${TEMP_FILE_SUFFIX}`;
    const payload = `${JSON.stringify(checkpoint, null, 2)}\n`;
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, path);
  }

  public async load(
    runId: string,
  ): Promise<AgentRunCheckpoint | undefined> {
    try {
      const raw = await readFile(this.pathFor(runId), "utf8");
      const parsed = JSON.parse(raw) as AgentRunCheckpoint;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        parsed.runId !== runId ||
        typeof parsed.requestId !== "string"
      ) {
        return undefined;
      }
      return parsed;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  public async delete(runId: string): Promise<void> {
    try {
      await rm(this.pathFor(runId), { force: true });
      await rm(`${this.pathFor(runId)}${TEMP_FILE_SUFFIX}`, {
        force: true,
      });
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  private pathFor(runId: string): string {
    return join(this.directory, `${sanitizeRunId(runId)}${CHECKPOINT_FILE_SUFFIX}`);
  }
}

function sanitizeRunId(runId: string): string {
  const trimmed = runId.trim();
  if (!trimmed) {
    throw new Error("Checkpoint runId must be non-empty.");
  }
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!safe || safe === "." || safe === "..") {
    throw new Error(`Checkpoint runId is not filesystem-safe: ${runId}`);
  }
  return safe;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
