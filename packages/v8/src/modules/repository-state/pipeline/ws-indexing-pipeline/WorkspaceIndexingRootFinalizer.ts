import {
  WORKSPACE_INDEXING_PIPELINE_IDS,
} from "./constants";

import type {
  WorkspaceIndexingRootFinalizerDependencies,
  WorkspaceIndexingRootFinalizerInput,
  WorkspaceIndexingRootResult,
  WorkspaceIndexingWarning,
} from "./types";

export class WorkspaceIndexingRootFinalizer {
  public readonly id =
    WORKSPACE_INDEXING_PIPELINE_IDS
      .ROOT_FINALIZER;

  constructor(
    private readonly dependencies:
      WorkspaceIndexingRootFinalizerDependencies,
  ) {}

  public async finalize(
    input:
      WorkspaceIndexingRootFinalizerInput,
  ): Promise<WorkspaceIndexingRootResult[]> {
    const results:
      WorkspaceIndexingRootResult[] =
      [];

    for (
      const root of
      [...input.roots]
        .sort(
          (
            left,
            right,
          ) =>
            left.id
              .localeCompare(
                right.id,
              ),
        )
    ) {
      if (
        input.request
          .abortSignal
          ?.aborted
      ) {
        results.push(
          this.cancelled(
            root.id,
          ),
        );

        continue;
      }

      if (
        root.kind ===
        "unavailable"
      ) {
        results.push(
          this.skipped(
            root.id,
          ),
        );

        continue;
      }

      results.push(
        await this.finalizeRoot(
          input,
          root.id,
        ),
      );
    }

    return results;
  }

  private async finalizeRoot(
    input:
      WorkspaceIndexingRootFinalizerInput,
    rootId:
      string,
  ): Promise<WorkspaceIndexingRootResult> {
    const warnings:
      WorkspaceIndexingWarning[] =
      [];

    let cleanupPerformed =
      false;
    let codeIndexRemovedFiles =
      0;
    let textIndexRemovedDocuments =
      0;
    let textIndexRemovedChunks =
      0;
    let cleanupTextRevision:
      number |
      undefined;
    let codeIndexRevision:
      number |
      undefined;

    if (
      input.cleanupAllowed &&
      input.request
        .cleanupMissing
    ) {
      cleanupPerformed =
        true;

      const retainedRelativePaths =
        input
          .retainedRelativePathsByRoot
          .get(
            rootId,
          ) ??
        [];

      const [
        codeCleanup,
        textCleanup,
      ] =
        await Promise
          .allSettled([
            this.dependencies
              .codeIndex
              .removeMissingFiles(
                {
                  workspace:
                    input
                      .request
                      .workspace,
                  rootId,
                  retainedRelativePaths,
                  workspaceSnapshotId:
                    input
                      .request
                      .snapshot
                      .snapshotId,
                  changedAt:
                    input
                      .request
                      .indexedAt,
                },
                this.context(
                  input,
                ),
              ),
            this.dependencies
              .textIndex
              .removeMissingDocuments(
                {
                  workspace:
                    input
                      .request
                      .workspace,
                  rootId,
                  retainedRelativePaths,
                  workspaceSnapshotId:
                    input
                      .request
                      .snapshot
                      .snapshotId,
                  changedAt:
                    input
                      .request
                      .indexedAt,
                },
                this.context(
                  input,
                ),
              ),
          ]);

      if (
        codeCleanup.status ===
        "fulfilled"
      ) {
        codeIndexRemovedFiles =
          codeCleanup
            .value
            .removedRelativePaths
            .length;
        codeIndexRevision =
          codeCleanup
            .value
            .revision;
      } else {
        warnings.push(
          this.warning(
            rootId,
            "cleanup",
            "cleanup_failed",
            codeCleanup.reason,
          ),
        );
      }

      if (
        textCleanup.status ===
        "fulfilled"
      ) {
        textIndexRemovedDocuments =
          textCleanup
            .value
            .removedRelativePaths
            .length;
        textIndexRemovedChunks =
          textCleanup
            .value
            .removedChunks;
        cleanupTextRevision =
          textCleanup
            .value
            .revision;
      } else {
        warnings.push(
          this.warning(
            rootId,
            "cleanup",
            "cleanup_failed",
            textCleanup.reason,
          ),
        );
      }
    }

    if (
      codeIndexRevision ===
      undefined
    ) {
      try {
        codeIndexRevision =
          await this.dependencies
            .codeIndex
            .getRevision(
              input.request
                .workspace,
              rootId,
              this.context(
                input,
              ),
            );
      } catch (
        error
      ) {
        warnings.push(
          this.warning(
            rootId,
            "cleanup",
            "cleanup_failed",
            error,
          ),
        );
      }
    }

    let embeddingStatus:
      WorkspaceIndexingRootResult[
        "embeddingStatus"
      ];
    let embeddingProfileId:
      string |
      undefined;
    let initialTextRevision:
      number |
      undefined;
    let finalTextRevision:
      number |
      undefined;
    let latestTextRevision:
      number |
      undefined =
      cleanupTextRevision;
    let embeddedChunks =
      0;
    let vectorsDeleted =
      0;

    if (
      !input.request
        .synchronizeEmbeddings &&
      this.dependencies
        .textIndex
        .getRevision
    ) {
      try {
        latestTextRevision =
          await this.dependencies
            .textIndex
            .getRevision(
              input.request
                .workspace,
              rootId,
              this.context(
                input,
              ),
            );
      } catch (
        error
      ) {
        warnings.push(
          this.warning(
            rootId,
            "cleanup",
            "cleanup_failed",
            error,
          ),
        );
      }
    }

    if (
      input.request
        .synchronizeEmbeddings
    ) {
      try {
        const embedding =
          await this.dependencies
            .embedding
            .synchronize({
              workspace:
                input.request
                  .workspace,
              rootId,
              updatedAt:
                input.request
                  .indexedAt,
              ...(input.request
                .abortSignal
                ? {
                    abortSignal:
                      input
                        .request
                        .abortSignal,
                  }
                : {}),
            });

        embeddingStatus =
          embedding.status;
        embeddingProfileId =
          embedding
            .profile.id;
        initialTextRevision =
          embedding
            .initialTextRevision;
        finalTextRevision =
          embedding
            .finalTextRevision;
        latestTextRevision =
          embedding
            .latestTextRevision;
        embeddedChunks =
          embedding
            .statistics
            .chunksEmbedded;
        vectorsDeleted =
          embedding
            .statistics
            .vectorsDeleted;
      } catch (
        error
      ) {
        warnings.push(
          this.warning(
            rootId,
            "embedding",
            "embedding_failed",
            error,
          ),
        );
      }
    }

    const cancelled =
      input.request
        .abortSignal
        ?.aborted ||
      embeddingStatus ===
        "cancelled";

    const skipped =
      !cleanupPerformed &&
      !input.request
        .synchronizeEmbeddings;

    return {
      rootId,
      status:
        cancelled
          ? "cancelled"
          : warnings
                .length > 0 ||
              embeddingStatus ===
                "partial"
            ? "partial"
            : skipped
              ? "skipped"
              : "complete",
      cleanupPerformed,
      codeIndexRemovedFiles,
      textIndexRemovedDocuments,
      textIndexRemovedChunks,
      ...(codeIndexRevision !==
      undefined
        ? {
            codeIndexRevision,
          }
        : {}),
      ...(embeddingStatus
        ? {
            embeddingStatus,
          }
        : {}),
      ...(embeddingProfileId
        ? {
            embeddingProfileId,
          }
        : {}),
      ...(initialTextRevision !==
      undefined
        ? {
            initialTextRevision,
          }
        : {}),
      ...(finalTextRevision !==
      undefined
        ? {
            finalTextRevision,
          }
        : {}),
      ...(latestTextRevision !==
      undefined
        ? {
            latestTextRevision,
          }
        : {}),
      embeddedChunks,
      vectorsDeleted,
      warnings,
    };
  }

  private context(
    input:
      WorkspaceIndexingRootFinalizerInput,
  ): {
    abortSignal?:
      AbortSignal;
  } {
    return input.request
      .abortSignal
      ? {
          abortSignal:
            input.request
              .abortSignal,
        }
      : {};
  }

  private skipped(
    rootId:
      string,
  ): WorkspaceIndexingRootResult {
    return {
      rootId,
      status:
        "skipped",
      cleanupPerformed:
        false,
      codeIndexRemovedFiles:
        0,
      textIndexRemovedDocuments:
        0,
      textIndexRemovedChunks:
        0,
      embeddedChunks:
        0,
      vectorsDeleted:
        0,
      warnings:
        [],
    };
  }

  private cancelled(
    rootId:
      string,
  ): WorkspaceIndexingRootResult {
    return {
      ...this.skipped(
        rootId,
      ),
      status:
        "cancelled",
      warnings: [
        {
          stage:
            "cleanup",
          code:
            "cancelled",
          message:
            "Workspace root finalization was cancelled.",
          rootId,
        },
      ],
    };
  }

  private warning(
    rootId:
      string,
    stage:
      "cleanup" |
      "embedding",
    code:
      "cleanup_failed" |
      "embedding_failed",
    error:
      unknown,
  ): WorkspaceIndexingWarning {
    return {
      stage,
      code,
      message:
        error
          instanceof Error
          ? error.message
          : String(
              error,
            ),
      rootId,
    };
  }
}
