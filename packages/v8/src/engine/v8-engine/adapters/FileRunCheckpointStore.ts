import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  restorePointSchema,
  type RestorePoint,
  type RestorePointSummary,
} from "../contracts/output/RestorePoint";
import type {
  AgentEngineRunCheckpointStorePort,
  AgentRunCheckpoint,
} from "../internal/RunCheckpoint";

const CHECKPOINT_FILE_SUFFIX = ".json";
const TEMP_FILE_SUFFIX = ".tmp";
const RESTORE_SUBDIR = "restore";

/**
 * Durable run-checkpoint + restore-point store under a host directory
 * (typically `<workspace>/.mitii/checkpoints/`).
 *
 * Layout:
 * - `<dir>/<runId>.json` — suspended AgentRunCheckpoint
 * - `<dir>/restore/<runId>/<restorePointId>.json` — RestorePoint (schemaVersion 1)
 *
 * Unknown RestorePoint schema versions are ignored on load (no dual reader).
 * Writes are atomic (temp file + rename).
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
    await this.deleteRestorePoints(runId);
  }

  public async saveRestorePoint(point: RestorePoint): Promise<void> {
    const parsed = restorePointSchema.parse(point);
    const dir = this.restoreDirFor(parsed.runId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${sanitizeId(parsed.restorePointId)}${CHECKPOINT_FILE_SUFFIX}`);
    const tempPath = `${path}${TEMP_FILE_SUFFIX}`;
    const payload = `${JSON.stringify(parsed, null, 2)}\n`;
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, path);
  }

  public async loadRestorePoint(
    runId: string,
    restorePointId: string,
  ): Promise<RestorePoint | undefined> {
    try {
      const path = join(
        this.restoreDirFor(runId),
        `${sanitizeId(restorePointId)}${CHECKPOINT_FILE_SUFFIX}`,
      );
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const result = restorePointSchema.safeParse(parsed);
      if (!result.success) {
        return undefined;
      }
      if (result.data.runId !== runId || result.data.restorePointId !== restorePointId) {
        return undefined;
      }
      return result.data;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  public async listRestorePoints(runId: string): Promise<RestorePointSummary[]> {
    const dir = this.restoreDirFor(runId);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const summaries: RestorePointSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(CHECKPOINT_FILE_SUFFIX) || name.endsWith(TEMP_FILE_SUFFIX)) {
        continue;
      }
      try {
        const raw = await readFile(join(dir, name), "utf8");
        const parsed = restorePointSchema.safeParse(JSON.parse(raw));
        if (!parsed.success || parsed.data.runId !== runId) {
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
      } catch {
        // Skip corrupt / unknown-version files (no dual reader).
      }
    }

    summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return summaries;
  }

  public async deleteRestorePoints(runId: string): Promise<void> {
    try {
      await rm(this.restoreDirFor(runId), { recursive: true, force: true });
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  private pathFor(runId: string): string {
    return join(this.directory, `${sanitizeId(runId)}${CHECKPOINT_FILE_SUFFIX}`);
  }

  private restoreDirFor(runId: string): string {
    return join(this.directory, RESTORE_SUBDIR, sanitizeId(runId));
  }
}

function sanitizeId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error("Checkpoint id must be non-empty.");
  }
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!safe || safe === "." || safe === "..") {
    throw new Error(`Checkpoint id is not filesystem-safe: ${id}`);
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
