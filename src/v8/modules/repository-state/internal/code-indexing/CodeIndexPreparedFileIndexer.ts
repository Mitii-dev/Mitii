import {
  CODE_INDEXING_DEFAULTS,
} from "./constants";

import {
  codeIndexCoordinatorResultSchema,
} from "./schema";

import {
  CodeIndexDocumentMapper,
} from "./CodeIndexDocumentMapper";

import {
  CodeIndexUpdater,
} from "./CodeIndexUpdater";

import {
  throwIfCodeIndexWriteAborted,
} from "./CodeIndexWriteError";

import type {
  CodeIndexCoordinatorResult,
  CodeIndexPreparedFileIndexerPort,
  CodeIndexPreparedFileInput,
} from "./types";

export class CodeIndexPreparedFileIndexer
  implements
    CodeIndexPreparedFileIndexerPort {
  constructor(
    private readonly mapper:
      CodeIndexDocumentMapper,
    private readonly updater:
      CodeIndexUpdater,
  ) {}

  public async index(
    input:
      CodeIndexPreparedFileInput,
  ): Promise<CodeIndexCoordinatorResult> {
    this.validateInput(
      input,
    );
    throwIfCodeIndexWriteAborted(
      input.abortSignal,
    );

    if (
      input.analysis.status ===
      "failed"
    ) {
      return this.validateResult({
        status:
          "analysis_failed",
        analysis:
          input.analysis,
      });
    }

    const document =
      this.mapper.map({
        workspace:
          input.workspace,
        snapshot:
          input.snapshot,
        file:
          input.file,
        contentHash:
          input.contentHash,
        analysisVersion:
          input.analysisVersion ??
          CODE_INDEXING_DEFAULTS
            .ANALYSIS_VERSION,
        analysis:
          input.analysis,
        indexedAt:
          input.indexedAt,
      });

    const update =
      await this.updater
        .update({
          document,
          ...(input.abortSignal
            ? {
                abortSignal:
                  input
                    .abortSignal,
              }
            : {}),
        });

    if (
      update.status !==
        "indexed" &&
      update.status !==
        "metadata_refreshed" &&
      update.status !==
        "unchanged"
    ) {
      throw new Error(
        `Unexpected prepared-file update status "${update.status}".`,
      );
    }

    return this.validateResult({
      status:
        input.analysis
          .status ===
        "unsupported"
          ? "unsupported"
          : update.status,
      analysis:
        input.analysis,
      update,
    });
  }

  private validateInput(
    input:
      CodeIndexPreparedFileInput,
  ): void {
    if (
      !input.workspace
        .trim()
    ) {
      throw new RangeError(
        "Code Index workspace cannot be empty.",
      );
    }

    if (
      input.file.kind !==
      "file"
    ) {
      throw new TypeError(
        "CodeIndexPreparedFileIndexer requires a WorkspaceFileEntry.",
      );
    }

    if (
      input.analysis.rootId !==
        input.file.rootId ||
      input.analysis
        .relativePath !==
        input.file
          .relativePath
    ) {
      throw new RangeError(
        "SourceAnalysis identity does not match the workspace file.",
      );
    }

    if (
      !input.contentHash
        .trim()
    ) {
      throw new RangeError(
        "contentHash cannot be empty.",
      );
    }

    if (
      !Number.isSafeInteger(
        input.indexedAt,
      ) ||
      input.indexedAt < 0
    ) {
      throw new RangeError(
        "indexedAt must be a non-negative safe integer.",
      );
    }
  }

  private validateResult(
    result:
      CodeIndexCoordinatorResult,
  ): CodeIndexCoordinatorResult {
    return codeIndexCoordinatorResultSchema
      .parse(
        result,
      ) as CodeIndexCoordinatorResult;
  }
}
