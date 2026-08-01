import { createHash } from "node:crypto";
import * as path from "node:path";

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
      const stat = await params.fileSystem.lstat(absolute);
      if (stat.kind === "directory") {
        files.push({ relativePath: normalized, kind: "directory" });
        continue;
      }
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
        const stat = await fileSystem.lstat(absolute);
        if (stat.kind === "directory") {
          await requireRmdir(fileSystem)(absolute, { recursive: true });
        } else {
          await fileSystem.unlink(absolute);
        }
      } catch {
        // Already absent — fine.
      }
      continue;
    }
    if (snapshot.kind === "directory") {
      await fileSystem.mkdirp(absolute);
      continue;
    }
    await fileSystem.writeFile(absolute, snapshot.content);
  }
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Collect repository-relative file paths under a directory (non-symlink). */
export async function listRelativeFilesUnder(params: {
  fileSystem: WorkspaceFileSystemPort;
  workspaceRoot: string;
  relativeDirectory: string;
}): Promise<string[]> {
  const { fileSystem, workspaceRoot } = params;
  const absoluteRoot = fileSystem.resolve(
    workspaceRoot,
    normalizeRelativePath(params.relativeDirectory),
  );
  const results: string[] = [];

  const walk = async (absoluteDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fileSystem.listDirectory(absoluteDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const absoluteChild = fileSystem.resolve(absoluteDir, entry.name);
      if (entry.kind === "symlink") {
        continue;
      }
      if (entry.kind === "directory") {
        await walk(absoluteChild);
        continue;
      }
      if (entry.kind !== "file") {
        continue;
      }
      results.push(
        normalizeRelativePath(path.relative(workspaceRoot, absoluteChild)),
      );
    }
  };

  await walk(absoluteRoot);
  return results;
}

export function mapMovedRelativePath(
  sourceRoot: string,
  destinationRoot: string,
  sourceFile: string,
): string {
  const normalizedSourceRoot = normalizeRelativePath(sourceRoot);
  const normalizedDestinationRoot = normalizeRelativePath(destinationRoot);
  const normalizedSourceFile = normalizeRelativePath(sourceFile);
  if (normalizedSourceFile === normalizedSourceRoot) {
    return normalizedDestinationRoot;
  }
  const prefix = `${normalizedSourceRoot}/`;
  if (!normalizedSourceFile.startsWith(prefix)) {
    throw new MutationError(
      "execution_failed",
      `Path "${normalizedSourceFile}" is not under "${normalizedSourceRoot}".`,
    );
  }
  return normalizeRelativePath(
    `${normalizedDestinationRoot}/${normalizedSourceFile.slice(prefix.length)}`,
  );
}

export function requireRename(
  fileSystem: WorkspaceFileSystemPort,
): NonNullable<WorkspaceFileSystemPort["rename"]> {
  if (!fileSystem.rename) {
    throw new MutationError(
      "execution_failed",
      "Filesystem adapter does not support rename.",
    );
  }
  return fileSystem.rename.bind(fileSystem);
}

export function requireRmdir(
  fileSystem: WorkspaceFileSystemPort,
): NonNullable<WorkspaceFileSystemPort["rmdir"]> {
  if (!fileSystem.rmdir) {
    throw new MutationError(
      "execution_failed",
      "Filesystem adapter does not support rmdir.",
    );
  }
  return fileSystem.rmdir.bind(fileSystem);
}
