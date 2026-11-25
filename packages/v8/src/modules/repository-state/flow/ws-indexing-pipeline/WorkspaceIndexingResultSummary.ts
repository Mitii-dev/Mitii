import {
  WORKSPACE_INDEXING_FILE_RESULT_SEVERITY,
  WORKSPACE_INDEXING_PIPELINE_MESSAGES,
  WORKSPACE_INDEXING_PIPELINE_SCHEMA_VERSION,
} from "./constants";

import type {
  NormalizedWorkspaceIndexingPipelineInput,
  WorkspaceIndexingFileResult,
  WorkspaceIndexingFileSelection,
  WorkspaceIndexingPipelineResult,
  WorkspaceIndexingPipelineStatistics,
  WorkspaceIndexingPipelineStatus,
  WorkspaceIndexingRootResult,
  WorkspaceIndexingWarning,
} from "./types";

export function emptyFinalizeSelection():
  WorkspaceIndexingFileSelection {
  return {
    availableFiles:
      0,
    selected:
      [],
    skipped:
      [],
    truncated:
      false,
    warnings:
      [],
    retainedRelativePathsByRoot:
      new Map(),
  };
}

export function resolveCleanupAllowed(
  request:
    NormalizedWorkspaceIndexingPipelineInput,
  selection:
    WorkspaceIndexingFileSelection,
  fileResults:
    readonly WorkspaceIndexingFileResult[],
  warnings:
    WorkspaceIndexingWarning[],
): boolean {
  if (
    !request
      .cleanupMissing
  ) {
    return false;
  }

  if (
    request.snapshot
      .status !==
    "complete"
  ) {
    warnings.push({
      stage:
        "cleanup",
      code:
        "cleanup_skipped",
      message:
        WORKSPACE_INDEXING_PIPELINE_MESSAGES
          .CLEANUP_PARTIAL_SNAPSHOT,
    });

    return false;
  }

  if (
    request.filePaths
      .length > 0
  ) {
    warnings.push({
      stage:
        "cleanup",
      code:
        "cleanup_skipped",
      message:
        WORKSPACE_INDEXING_PIPELINE_MESSAGES
          .CLEANUP_FILTERED_RUN,
    });

    return false;
  }

  if (
    selection.warnings
      .some(
        (warning) =>
          warning.code ===
          "file_policy_failed",
      )
  ) {
    warnings.push({
      stage:
        "cleanup",
      code:
        "cleanup_skipped",
      message:
        WORKSPACE_INDEXING_PIPELINE_MESSAGES
          .CLEANUP_POLICY_FAILURE,
    });

    return false;
  }

  if (
    selection.truncated ||
    fileResults.length !==
      selection.selected
        .length
  ) {
    warnings.push({
      stage:
        "cleanup",
      code:
        "cleanup_skipped",
      message:
        WORKSPACE_INDEXING_PIPELINE_MESSAGES
          .CLEANUP_TRUNCATED_RUN,
    });

    return false;
  }

  return !request
    .abortSignal
    ?.aborted;
}

export function summarizeStatistics(
  selection:
    WorkspaceIndexingFileSelection,
  fileResults:
    readonly WorkspaceIndexingFileResult[],
  rootResults:
    readonly WorkspaceIndexingRootResult[],
): Omit<
  WorkspaceIndexingPipelineStatistics,
  "reportedFileResults"
> {
  const countStatus =
    (
      status:
        WorkspaceIndexingFileResult[
          "status"
        ],
    ) =>
      fileResults.filter(
        (result) =>
          result.status ===
          status,
      ).length;

  return {
    availableFiles:
      selection
        .availableFiles,
    selectedFiles:
      selection
        .selected
        .length,
    skippedFiles:
      selection
        .skipped
        .length,
    processedFiles:
      fileResults.length,
    completeFiles:
      countStatus(
        "complete",
      ),
    partialFiles:
      countStatus(
        "partial",
      ),
    failedFiles:
      countStatus(
        "failed",
      ),
    cancelledFiles:
      countStatus(
        "cancelled",
      ),
    analysisFailures:
      fileResults.filter(
        (result) =>
          result
            .analysisStatus ===
            "failed" ||
          result.warnings
            .some(
              (warning) =>
                warning.stage ===
                "analysis",
            ),
      ).length,
    emittedChunks:
      fileResults.reduce(
        (
          total,
          result,
        ) =>
          total +
          result
            .emittedChunks,
        0,
      ),
    estimatedTokens:
      fileResults.reduce(
        (
          total,
          result,
        ) =>
          total +
          result
            .estimatedTokens,
        0,
      ),
    codeIndexUpdates:
      fileResults.filter(
        (result) =>
          result
            .codeIndexChanged,
      ).length,
    textIndexUpdates:
      fileResults.filter(
        (result) =>
          result
            .textIndexChanged,
      ).length,
    embeddedChunks:
      rootResults.reduce(
        (
          total,
          result,
        ) =>
          total +
          result
            .embeddedChunks,
        0,
      ),
    removedCodeIndexFiles:
      rootResults.reduce(
        (
          total,
          result,
        ) =>
          total +
          result
            .codeIndexRemovedFiles,
        0,
      ),
    removedTextIndexDocuments:
      rootResults.reduce(
        (
          total,
          result,
        ) =>
          total +
          result
            .textIndexRemovedDocuments,
        0,
      ),
    removedTextIndexChunks:
      rootResults.reduce(
        (
          total,
          result,
        ) =>
          total +
          result
            .textIndexRemovedChunks,
        0,
      ),
  };
}

export function reportedFileResults(
  results:
    readonly WorkspaceIndexingFileResult[],
  maximum:
    number,
): {
  reported:
    WorkspaceIndexingFileResult[];
  truncated:
    boolean;
} {
  const ordered =
    [...results]
      .sort(
        (
          left,
          right,
        ) =>
          WORKSPACE_INDEXING_FILE_RESULT_SEVERITY[
            left.status
          ] -
            WORKSPACE_INDEXING_FILE_RESULT_SEVERITY[
              right.status
            ] ||
          left.rootId
            .localeCompare(
              right.rootId,
            ) ||
          left.relativePath
            .localeCompare(
              right
                .relativePath,
            ),
      );

  return {
    reported:
      ordered.slice(
        0,
        maximum,
      ),
    truncated:
      ordered.length >
      maximum,
  };
}

export function resolveStatus(
  request:
    NormalizedWorkspaceIndexingPipelineInput,
  selection:
    WorkspaceIndexingFileSelection,
  fileResults:
    readonly WorkspaceIndexingFileResult[],
  rootResults:
    readonly WorkspaceIndexingRootResult[],
): WorkspaceIndexingPipelineStatus {
  if (
    request.abortSignal
      ?.aborted ||
    rootResults.some(
      (result) =>
        result.status ===
        "cancelled",
    )
  ) {
    return "cancelled";
  }

  const failedFiles =
    fileResults.filter(
      (result) =>
        result.status ===
        "failed",
    ).length;

  if (
    request.failureMode ===
      "fail_fast" &&
    failedFiles > 0
  ) {
    return "failed";
  }

  const rootDidWork =
    rootResults.some(
      (result) =>
        result
          .cleanupPerformed ||
        result.embeddingStatus !==
          undefined,
    );

  if (
    selection.selected
      .length === 0 &&
    !rootDidWork
  ) {
    return "empty";
  }

  if (
    request.snapshot
      .status !==
      "complete" ||
    selection.truncated ||
    fileResults.length !==
      selection.selected
        .length ||
    fileResults.some(
      (result) =>
        result.status !==
        "complete",
    ) ||
    rootResults.some(
      (result) =>
        result.status ===
        "partial",
    )
  ) {
    return "partial";
  }

  return "complete";
}

export function cancelledResult(
  request:
    NormalizedWorkspaceIndexingPipelineInput,
): WorkspaceIndexingPipelineResult {
  return {
    schemaVersion:
      WORKSPACE_INDEXING_PIPELINE_SCHEMA_VERSION,
    workspace:
      request.workspace,
    workspaceSnapshotId:
      request.snapshot
        .snapshotId,
    indexedAt:
      request.indexedAt,
    status:
      "cancelled",
    fileResults:
      [],
    fileResultsTruncated:
      false,
    rootResults:
      [],
    warnings: [
      {
        stage:
          "selection",
        code:
          "cancelled",
        message:
          "Workspace indexing was cancelled before file selection.",
      },
    ],
    cleanupAllowed:
      false,
    statistics:
      emptyStatistics(),
  };
}

export function emptyStatistics():
  WorkspaceIndexingPipelineStatistics {
  return {
    availableFiles:
      0,
    selectedFiles:
      0,
    skippedFiles:
      0,
    processedFiles:
      0,
    completeFiles:
      0,
    partialFiles:
      0,
    failedFiles:
      0,
    cancelledFiles:
      0,
    analysisFailures:
      0,
    emittedChunks:
      0,
    estimatedTokens:
      0,
    codeIndexUpdates:
      0,
    textIndexUpdates:
      0,
    embeddedChunks:
      0,
    removedCodeIndexFiles:
      0,
    removedTextIndexDocuments:
      0,
    removedTextIndexChunks:
      0,
    reportedFileResults:
      0,
  };
}
