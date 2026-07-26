import { createHash } from "node:crypto";

import type { WorkspaceFileSystemPort } from "../../contracts";
import { normalizeRelativePath } from "../PathContainment";
import { MutationError } from "./types";
import type { CheckpointFileSnapshot, MutationCheckpoint } from "./types";

/**
 * Rejects mutating paths that are dirty outside this transaction.
 * Agent-owned prior writes (alreadyMutated) are allowed to change again.
 */
export function assertNoDirtyOverlap(params: {
  targetPaths: readonly string[];
  dirtyPaths: readonly string[];
  alreadyMutatedPaths?: readonly string[];
}): void {
  const dirty = new Set(
    params.dirtyPaths.map((p) => normalizeRelativePath(p)),
  );
  const owned = new Set(
    (params.alreadyMutatedPaths ?? []).map((p) => normalizeRelativePath(p)),
  );

  for (const target of params.targetPaths) {
    const normalized = normalizeRelativePath(target);
    if (owned.has(normalized)) {
      continue;
    }
    if (dirty.has(normalized)) {
      throw new MutationError(
        "dirty_overlap",
        `Refusing to mutate dirty path outside the transaction: "${normalized}".`,
      );
    }
  }
}

export async function createFileCopyCheckpoint(params: {
  checkpointId: string;
  workspaceRoot: string;
  relativePaths: readonly string[];
  fileSystem: WorkspaceFileSystemPort;
  nowIso: string;
}): Promise<MutationCheckpoint> {
  const files: CheckpointFileSnapshot[] = [];
  for (const relativePath of params.relativePaths) {
    const normalized = normalizeRelativePath(relativePath);
    const absolute = params.fileSystem.resolve(
      params.workspaceRoot,
      normalized,
    );
    try {
      const read = await params.fileSystem.readFile(absolute);
      files.push({
        relativePath: normalized,
        kind: "existing",
        content: read.content,
      });
    } catch {
      files.push({ relativePath: normalized, kind: "missing" });
    }
  }

  return {
    checkpointId: params.checkpointId,
    workspaceRoot: params.workspaceRoot,
    files,
    createdAt: params.nowIso,
  };
}

export async function restoreFileCopyCheckpoint(params: {
  checkpoint: MutationCheckpoint;
  fileSystem: WorkspaceFileSystemPort;
}): Promise<void> {
  const { checkpoint, fileSystem } = params;
  for (const snapshot of checkpoint.files) {
    const absolute = fileSystem.resolve(
      checkpoint.workspaceRoot,
      snapshot.relativePath,
    );
    if (snapshot.kind === "missing") {
      try {
        await fileSystem.unlink(absolute);
      } catch {
        // Already absent — fine.
      }
      continue;
    }
    await fileSystem.writeFile(absolute, snapshot.content);
  }
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
