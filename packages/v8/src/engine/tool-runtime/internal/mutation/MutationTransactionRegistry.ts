import type { WorkspaceFileSystemPort } from "../../contracts";
import {
  normalizeRelativePath,
  resolveContainedPath,
} from "../PathContainment";
import {
  preflightStructuredPatch,
  validatePostEditSyntax,
} from "./applyStructuredPatch";
import {
  assertNoDirtyOverlap,
  createFileCopyCheckpoint,
  listRelativeFilesUnder,
  mapMovedRelativePath,
  requireRename,
  requireRmdir,
  restoreFileCopyCheckpoint,
} from "./checkpoint";
import { MutationError } from "./types";
import { describeCaughtError } from "../describeCaughtError";
import type {
  AppliedPatchRecord,
  MutationCheckpoint,
  StructuredPatch,
} from "./types";

export interface MutationTransactionApplyResult {
  checkpointId: string;
  changedFiles: string[];
  applied: AppliedPatchRecord[];
}

export interface MutationPathResult {
  checkpointId: string;
  changedFiles: string[];
}

/**
 * In-memory registry of recoverable file-copy checkpoints for a Tool Runtime
 * instance. Checkpoints retain only paths touched by the transaction so user
 * edits outside those paths are preserved on rollback.
 */
export class MutationTransactionRegistry {
  private readonly checkpoints = new Map<string, MutationCheckpoint>();

  constructor(
    private readonly idGenerator: () => string = () =>
      `cp_${Math.random().toString(36).slice(2, 12)}`,
  ) {}

  public get(checkpointId: string): MutationCheckpoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  public async applyPatches(params: {
    workspaceRoot: string;
    pathScopes: readonly string[];
    fileSystem: WorkspaceFileSystemPort;
    patches: readonly StructuredPatch[];
    dirtyPaths?: readonly string[];
    alreadyMutatedPaths?: readonly string[];
    nowIso?: string;
  }): Promise<MutationTransactionApplyResult> {
    const relativePaths = [
      ...new Set(
        params.patches.map((patch) => normalizeRelativePath(patch.path)),
      ),
    ];

    assertNoDirtyOverlap({
      targetPaths: relativePaths,
      dirtyPaths: params.dirtyPaths ?? [],
      alreadyMutatedPaths: params.alreadyMutatedPaths,
    });

    const containedByPath = new Map<
      string,
      Awaited<ReturnType<typeof resolveContainedPath>>
    >();
    for (const relativePath of relativePaths) {
      const contained = await resolveContainedPath({
        fileSystem: params.fileSystem,
        workspaceRoot: params.workspaceRoot,
        requestedPath: relativePath,
        pathScopes: params.pathScopes,
        mustExist: false,
      });
      containedByPath.set(relativePath, contained);
    }

    const proposed = new Map<
      string,
      { content: string; created: boolean }
    >();
    for (const patch of params.patches) {
      const relativePath = normalizeRelativePath(patch.path);
      const contained = containedByPath.get(relativePath)!;
      let current: string | undefined;
      try {
        const read = await params.fileSystem.readFile(contained.absolutePath);
        current = read.content;
      } catch {
        current = undefined;
      }

      // Allow chained patches in one transaction against the proposed buffer.
      if (proposed.has(relativePath)) {
        current = proposed.get(relativePath)!.content;
      }

      try {
        const preflight = preflightStructuredPatch({
          patch: { ...patch, path: relativePath },
          currentContent: current,
        });
        validatePostEditSyntax(relativePath, preflight.proposedContent);
        proposed.set(relativePath, {
          content: preflight.proposedContent,
          created:
            (proposed.get(relativePath)?.created ?? false) || preflight.created,
        });
      } catch (error) {
        throw attachPatchConflictContent(error, relativePath, current);
      }
    }

    const checkpointId = this.idGenerator();
    const checkpoint = await createFileCopyCheckpoint({
      checkpointId,
      workspaceRoot: params.workspaceRoot,
      relativePaths,
      fileSystem: params.fileSystem,
      nowIso: params.nowIso ?? new Date().toISOString(),
    });
    this.checkpoints.set(checkpointId, checkpoint);

    const applied: AppliedPatchRecord[] = [];
    try {
      for (const [relativePath, next] of proposed) {
        const contained = containedByPath.get(relativePath)!;
        await params.fileSystem.writeFile(
          contained.absolutePath,
          next.content,
        );
        applied.push({
          path: relativePath,
          created: next.created,
          bytesWritten: Buffer.byteLength(next.content, "utf8"),
        });
      }
    } catch (error) {
      const rollbackSuffix = await this.restoreCheckpointBestEffort(
        checkpoint,
        params.fileSystem,
      );
      this.checkpoints.delete(checkpointId);
      if (error instanceof MutationError) {
        throw rollbackSuffix
          ? new MutationError(
              error.reasonCode,
              `${error.message}${rollbackSuffix}`,
              error.details,
            )
          : error;
      }
      throw new MutationError(
        "execution_failed",
        `Failed to apply mutation: ${describeCaughtError(error)}${rollbackSuffix}`,
      );
    }

    return {
      checkpointId,
      changedFiles: applied.map((entry) => entry.path),
      applied,
    };
  }

  public async deleteFile(params: {
    workspaceRoot: string;
    pathScopes: readonly string[];
    fileSystem: WorkspaceFileSystemPort;
    path: string;
    dirtyPaths?: readonly string[];
    alreadyMutatedPaths?: readonly string[];
    nowIso?: string;
  }): Promise<MutationPathResult> {
    const relativePath = normalizeRelativePath(params.path);
    if (relativePath === ".") {
      throw new MutationError(
        "path_escape",
        "Refusing to delete the workspace root.",
      );
    }

    assertNoDirtyOverlap({
      targetPaths: [relativePath],
      dirtyPaths: params.dirtyPaths ?? [],
      alreadyMutatedPaths: params.alreadyMutatedPaths,
    });

    const contained = await resolveContainedPath({
      fileSystem: params.fileSystem,
      workspaceRoot: params.workspaceRoot,
      requestedPath: relativePath,
      pathScopes: params.pathScopes,
      mustExist: true,
    });

    const stat = await params.fileSystem.lstat(contained.absolutePath);
    if (stat.kind !== "file") {
      throw new MutationError(
        "invalid_arguments",
        `delete_file requires a file path; "${relativePath}" is a ${stat.kind}. Use delete_directory for directories.`,
      );
    }

    return this.runRecoverableMutation({
      workspaceRoot: params.workspaceRoot,
      fileSystem: params.fileSystem,
      relativePaths: [relativePath],
      changedFiles: [relativePath],
      nowIso: params.nowIso,
      mutate: async () => {
        await params.fileSystem.unlink(contained.absolutePath);
      },
      failureMessage: "delete_file failed",
    });
  }

  public async deleteDirectory(params: {
    workspaceRoot: string;
    pathScopes: readonly string[];
    fileSystem: WorkspaceFileSystemPort;
    path: string;
    recursive?: boolean;
    dirtyPaths?: readonly string[];
    alreadyMutatedPaths?: readonly string[];
    nowIso?: string;
  }): Promise<MutationPathResult> {
    const relativePath = normalizeRelativePath(params.path);
    if (relativePath === ".") {
      throw new MutationError(
        "path_escape",
        "Refusing to delete the workspace root.",
      );
    }

    const recursive = params.recursive ?? true;
    const contained = await resolveContainedPath({
      fileSystem: params.fileSystem,
      workspaceRoot: params.workspaceRoot,
      requestedPath: relativePath,
      pathScopes: params.pathScopes,
      mustExist: true,
    });

    const stat = await params.fileSystem.lstat(contained.absolutePath);
    if (stat.kind !== "directory") {
      throw new MutationError(
        "invalid_arguments",
        `delete_directory requires a directory path; "${relativePath}" is a ${stat.kind}. Use delete_file for files.`,
      );
    }

    const nestedFiles = await listRelativeFilesUnder({
      fileSystem: params.fileSystem,
      workspaceRoot: params.workspaceRoot,
      relativeDirectory: relativePath,
    });

    if (!recursive && nestedFiles.length > 0) {
      throw new MutationError(
        "invalid_arguments",
        `Directory "${relativePath}" is not empty. Pass recursive=true to delete it.`,
      );
    }

    const targetPaths = [relativePath, ...nestedFiles];
    assertNoDirtyOverlap({
      targetPaths,
      dirtyPaths: params.dirtyPaths ?? [],
      alreadyMutatedPaths: params.alreadyMutatedPaths,
    });

    return this.runRecoverableMutation({
      workspaceRoot: params.workspaceRoot,
      fileSystem: params.fileSystem,
      relativePaths: nestedFiles.length > 0 ? nestedFiles : [relativePath],
      changedFiles: [relativePath, ...nestedFiles],
      nowIso: params.nowIso,
      mutate: async () => {
        await requireRmdir(params.fileSystem)(contained.absolutePath, {
          recursive,
        });
      },
      failureMessage: "delete_directory failed",
    });
  }

  public async moveFile(params: {
    workspaceRoot: string;
    pathScopes: readonly string[];
    fileSystem: WorkspaceFileSystemPort;
    from: string;
    to: string;
    dirtyPaths?: readonly string[];
    alreadyMutatedPaths?: readonly string[];
    nowIso?: string;
  }): Promise<MutationPathResult> {
    const fromPath = normalizeRelativePath(params.from);
    const toPath = normalizeRelativePath(params.to);
    if (fromPath === "." || toPath === ".") {
      throw new MutationError(
        "path_escape",
        "Refusing to move the workspace root.",
      );
    }
    if (fromPath === toPath) {
      throw new MutationError(
        "invalid_arguments",
        "move_file requires distinct from and to paths.",
      );
    }

    const fromContained = await resolveContainedPath({
      fileSystem: params.fileSystem,
      workspaceRoot: params.workspaceRoot,
      requestedPath: fromPath,
      pathScopes: params.pathScopes,
      mustExist: true,
    });
    const toContained = await resolveContainedPath({
      fileSystem: params.fileSystem,
      workspaceRoot: params.workspaceRoot,
      requestedPath: toPath,
      pathScopes: params.pathScopes,
      mustExist: false,
    });

    try {
      await params.fileSystem.lstat(toContained.absolutePath);
      throw new MutationError(
        "invalid_arguments",
        `Destination already exists: "${toPath}".`,
      );
    } catch (error) {
      if (error instanceof MutationError) {
        throw error;
      }
      // Destination missing — expected.
    }

    const fromStat = await params.fileSystem.lstat(fromContained.absolutePath);
    const nestedSourceFiles =
      fromStat.kind === "directory"
        ? await listRelativeFilesUnder({
            fileSystem: params.fileSystem,
            workspaceRoot: params.workspaceRoot,
            relativeDirectory: fromPath,
          })
        : [fromPath];

    const sourceFiles =
      fromStat.kind === "directory" && nestedSourceFiles.length === 0
        ? [fromPath]
        : nestedSourceFiles;

    const destinationFiles = sourceFiles.map((sourceFile) =>
      mapMovedRelativePath(fromPath, toPath, sourceFile),
    );

    assertNoDirtyOverlap({
      targetPaths: [...sourceFiles, fromPath, toPath, ...destinationFiles],
      dirtyPaths: params.dirtyPaths ?? [],
      alreadyMutatedPaths: params.alreadyMutatedPaths,
    });

    const checkpointPaths = [
      ...new Set([
        ...(fromStat.kind === "directory" ? [fromPath] : []),
        ...sourceFiles,
        toPath,
        ...destinationFiles,
      ]),
    ];

    return this.runRecoverableMutation({
      workspaceRoot: params.workspaceRoot,
      fileSystem: params.fileSystem,
      relativePaths: checkpointPaths,
      changedFiles: [...new Set([fromPath, toPath, ...destinationFiles])],
      nowIso: params.nowIso,
      mutate: async () => {
        await requireRename(params.fileSystem)(
          fromContained.absolutePath,
          toContained.absolutePath,
        );
      },
      failureMessage: "move_file failed",
    });
  }

  public async rollback(params: {
    checkpointId: string;
    fileSystem: WorkspaceFileSystemPort;
  }): Promise<string[]> {
    const checkpoint = this.checkpoints.get(params.checkpointId);
    if (!checkpoint) {
      throw new MutationError(
        "checkpoint_missing",
        `Unknown checkpoint "${params.checkpointId}".`,
      );
    }
    try {
      await restoreFileCopyCheckpoint({
        checkpoint,
        fileSystem: params.fileSystem,
      });
    } catch (error) {
      throw new MutationError(
        "rollback_failed",
        `Failed to restore checkpoint "${params.checkpointId}": ${describeCaughtError(error)}`,
      );
    }
    this.checkpoints.delete(params.checkpointId);
    return checkpoint.files.map((file) => file.relativePath);
  }

  public commit(checkpointId: string): void {
    this.checkpoints.delete(checkpointId);
  }

  /**
   * Restores a checkpoint after a mutation failure without letting a
   * rollback error mask the mutation's original error — previously the
   * rollback failure entirely replaced the real cause. Returns a message
   * suffix (empty string when rollback succeeded) to attach to the original
   * error, since a double-fault leaves the workspace in a state the caller
   * must know about.
   */
  private async restoreCheckpointBestEffort(
    checkpoint: MutationCheckpoint,
    fileSystem: WorkspaceFileSystemPort,
  ): Promise<string> {
    try {
      await restoreFileCopyCheckpoint({ checkpoint, fileSystem });
      return "";
    } catch (restoreError) {
      return ` (rollback also failed, workspace may be partially mutated: ${describeCaughtError(restoreError)})`;
    }
  }

  private async runRecoverableMutation(params: {
    workspaceRoot: string;
    fileSystem: WorkspaceFileSystemPort;
    relativePaths: readonly string[];
    changedFiles: readonly string[];
    nowIso?: string;
    mutate: () => Promise<void>;
    failureMessage: string;
  }): Promise<MutationPathResult> {
    const checkpointId = this.idGenerator();
    const checkpoint = await createFileCopyCheckpoint({
      checkpointId,
      workspaceRoot: params.workspaceRoot,
      relativePaths: params.relativePaths,
      fileSystem: params.fileSystem,
      nowIso: params.nowIso ?? new Date().toISOString(),
    });
    this.checkpoints.set(checkpointId, checkpoint);

    try {
      await params.mutate();
    } catch (error) {
      const rollbackSuffix = await this.restoreCheckpointBestEffort(
        checkpoint,
        params.fileSystem,
      );
      this.checkpoints.delete(checkpointId);
      if (error instanceof MutationError) {
        throw rollbackSuffix
          ? new MutationError(
              error.reasonCode,
              `${error.message}${rollbackSuffix}`,
              error.details,
            )
          : error;
      }
      throw new MutationError(
        "execution_failed",
        `${params.failureMessage}: ${describeCaughtError(error)}${rollbackSuffix}`,
      );
    }

    return {
      checkpointId,
      changedFiles: [...params.changedFiles],
    };
  }
}

const PATCH_CONFLICT_CONTENT_CHARS = 16_000;

function attachPatchConflictContent(
  error: unknown,
  path: string,
  currentContent: string | undefined,
): unknown {
  if (!(error instanceof MutationError) || error.reasonCode !== "patch_conflict") {
    return error;
  }
  if (currentContent === undefined) {
    return error;
  }
  const clipped =
    currentContent.length > PATCH_CONFLICT_CONTENT_CHARS
      ? `${currentContent.slice(0, PATCH_CONFLICT_CONTENT_CHARS)}\n…[truncated]`
      : currentContent;
  return new MutationError(error.reasonCode, error.message, {
    ...error.details,
    path,
    currentContent: clipped,
  });
}
