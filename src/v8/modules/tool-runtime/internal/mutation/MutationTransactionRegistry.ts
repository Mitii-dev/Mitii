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
  restoreFileCopyCheckpoint,
} from "./checkpoint";
import { MutationError } from "./types";
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
      await restoreFileCopyCheckpoint({
        checkpoint,
        fileSystem: params.fileSystem,
      });
      this.checkpoints.delete(checkpointId);
      if (error instanceof MutationError) {
        throw error;
      }
      throw new MutationError(
        "execution_failed",
        `Failed to apply mutation: ${String(error)}`,
      );
    }

    return {
      checkpointId,
      changedFiles: applied.map((entry) => entry.path),
      applied,
    };
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
        `Failed to restore checkpoint "${params.checkpointId}": ${String(error)}`,
      );
    }
    this.checkpoints.delete(params.checkpointId);
    return checkpoint.files.map((file) => file.relativePath);
  }

  public commit(checkpointId: string): void {
    this.checkpoints.delete(checkpointId);
  }
}
