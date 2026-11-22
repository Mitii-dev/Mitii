import type {
  WorkspaceIndexingFileProcessorInput,
  WorkspaceIndexingFileResult,
  WorkspaceIndexingStage,
  WorkspaceIndexingWarning,
} from "./types";

import type {
  SourceAnalysis,
} from "../../internal/source-analysis/types";

import type {
  ChunkingResult,
} from "../../internal/chunking/types";

import type {
  CodeIndexCoordinatorResult,
} from "../../internal/code-indexing/types";

import type {
  TextIndexCoordinatorResult,
} from "../../internal/text-index/types";

export function buildFileResult(
  input: {
    selected:
      WorkspaceIndexingFileProcessorInput[
        "selected"
      ];
    status:
      WorkspaceIndexingFileResult[
        "status"
      ];
    analysis?:
      SourceAnalysis;
    chunking?:
      ChunkingResult;
    codeIndex?:
      CodeIndexCoordinatorResult;
    textIndex?:
      TextIndexCoordinatorResult;
    contentHash?:
      string;
    warnings:
      WorkspaceIndexingWarning[];
  },
): WorkspaceIndexingFileResult {
  return {
    rootId:
      input.selected
        .file
        .rootId,
    relativePath:
      input.selected
        .file
        .relativePath,
    sourceId:
      input.selected
        .sourceId,
    status:
      input.status,
    ...(input.analysis
      ? {
          analysisStatus:
            input.analysis
              .status,
        }
      : {}),
    analysisWarnings:
      input.analysis
        ?.warnings
        .length ??
      0,
    ...(input.chunking
      ? {
          chunkingStatus:
            input.chunking
              .status,
        }
      : {}),
    chunkingWarnings:
      input.chunking
        ?.warnings
        .length ??
      0,
    emittedChunks:
      input.chunking
        ?.chunks
        .length ??
      0,
    estimatedTokens:
      input.chunking
        ?.statistics
        .estimatedTokens ??
      0,
    ...(input.codeIndex
      ? {
          codeIndexStatus:
            input.codeIndex
              .status,
        }
      : {}),
    codeIndexChanged:
      input.codeIndex
        ?.update
        ?.status ===
        "indexed" ||
      input.codeIndex
        ?.update
        ?.status ===
        "metadata_refreshed",
    ...(input.textIndex
      ? {
          textIndexStatus:
            input.textIndex
              .status,
        }
      : {}),
    textIndexChanged:
      input.textIndex
        ?.update
        ?.status ===
        "indexed" ||
      input.textIndex
        ?.update
        ?.status ===
        "metadata_refreshed",
    warnings:
      input.warnings,
    ...(input.contentHash
      ? {
          contentHash:
            input.contentHash,
        }
      : {}),
  };
}


export function buildFailedFileResult(
  input: {
    selected:
      WorkspaceIndexingFileProcessorInput[
        "selected"
      ];
    stage:
      WorkspaceIndexingStage;
    error:
      unknown;
  },
): WorkspaceIndexingFileResult {
  return buildFileResult({
    selected:
      input.selected,
    status:
      "failed",
    warnings: [
      buildFileWarning(
        input,
      ),
    ],
  });
}


export function buildCancelledFileResult(
  rootId:
    string,
  relativePath:
    string,
  sourceId:
    string,
): WorkspaceIndexingFileResult {
  return {
    rootId,
    relativePath,
    sourceId,
    status:
      "cancelled",
    analysisWarnings:
      0,
    chunkingWarnings:
      0,
    emittedChunks:
      0,
    estimatedTokens:
      0,
    codeIndexChanged:
      false,
    textIndexChanged:
      false,
    warnings: [
      {
        stage:
          "read",
        code:
          "cancelled",
        message:
          "Workspace file indexing was cancelled.",
        rootId,
        relativePath,
      },
    ],
  };
}


export function buildFileWarning(
  input: {
    selected:
      WorkspaceIndexingFileProcessorInput[
        "selected"
      ];
    stage:
      WorkspaceIndexingStage;
    error:
      unknown;
  },
): WorkspaceIndexingWarning {
  return {
    stage:
      input.stage,
    code:
      "file_stage_failed",
    message:
      errorMessage(
        input.error,
      ),
    rootId:
      input.selected
        .file
        .rootId,
    relativePath:
      input.selected
        .file
        .relativePath,
  };
}


function errorMessage(
  error:
    unknown,
): string {
  return error
    instanceof Error
    ? error.message
    : String(
        error,
      );
}
