import {
  CODE_INDEXING_DEFAULTS,
} from "./constants";

import {
  CodeIndexDocumentMapper,
} from "./CodeIndexDocumentMapper";

import {
  throwIfCodeIndexWriteAborted,
} from "./CodeIndexWriteError";

import type {
  CodeIndexContentHasher,
  CodeIndexCoordinatorInput,
  CodeIndexCoordinatorResult,
  CodeIndexSourceAnalyzer,
  CodeIndexSourceReader,
} from "./types";

import {
  CodeIndexUpdater,
} from "./CodeIndexUpdater";

export class CodeIndexCoordinator {
  constructor(
    private readonly reader:
      CodeIndexSourceReader,
    private readonly analyzer:
      CodeIndexSourceAnalyzer,
    private readonly hasher:
      CodeIndexContentHasher,
    private readonly mapper:
      CodeIndexDocumentMapper,
    private readonly updater:
      CodeIndexUpdater,
  ) {}

  public async processFile(
    input: CodeIndexCoordinatorInput,
  ): Promise<CodeIndexCoordinatorResult> {
    this.validateInput(input);
    throwIfCodeIndexWriteAborted(
      input.abortSignal,
    );

    const sourceId =
      input.sourceId ??
      [
        input.file.rootId,
        input.file.relativePath,
      ].join(":");

    const source =
      await this.reader.read({
        sourceId,
        file: input.file,
      });

    throwIfCodeIndexWriteAborted(
      input.abortSignal,
    );

    const analysis =
      await this.analyzer.analyze({
        sourceId,
        file: input.file,
        content: source.content,

        ...(input.language
          ? {
              language:
                input.language,
            }
          : {}),

        ...(input.referenceCandidates
          ? {
              referenceCandidates:
                input.referenceCandidates,
            }
          : {}),

        ...(input.abortSignal
          ? {
              abortSignal:
                input.abortSignal,
            }
          : {}),
      });

    if (
      analysis.status === "failed"
    ) {
      return {
        status: "analysis_failed",
        analysis,
      };
    }

    /*
     * Hash the bytes that were actually analyzed. A snapshot hash can
     * become stale when the file changes between scanning and reading.
     */
    const contentHash =
      await this.hasher.hash(
        source.content,
      );

    const document =
      this.mapper.map({
        workspace:
          input.workspace,
        snapshot:
          input.snapshot,
        file:
          input.file,
        contentHash,
        analysisVersion:
          input.analysisVersion ??
          CODE_INDEXING_DEFAULTS
            .ANALYSIS_VERSION,
        analysis,
        indexedAt:
          input.indexedAt,
      });

    const update =
      await this.updater.update({
        document,
        ...(input.abortSignal
          ? {
              abortSignal:
                input.abortSignal,
            }
          : {}),
      });

    if (
      analysis.status ===
        "unsupported"
    ) {
      return {
        status: "unsupported",
        analysis,
        update,
      };
    }

    if (
      update.status !== "indexed" &&
      update.status !==
        "metadata_refreshed" &&
      update.status !== "unchanged"
    ) {
      throw new Error(
        `Unexpected coordinator update status "${update.status}".`,
      );
    }

    return {
      status: update.status,
      analysis,
      update,
    };
  }

  private validateInput(
    input: CodeIndexCoordinatorInput,
  ): void {
    if (!input.workspace.trim()) {
      throw new RangeError(
        "Code Index workspace cannot be empty.",
      );
    }

    if (
      input.file.kind !== "file"
    ) {
      throw new TypeError(
        "CodeIndexCoordinator requires a WorkspaceFileEntry.",
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
}
