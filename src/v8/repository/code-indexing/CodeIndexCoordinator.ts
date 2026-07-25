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
  CodeIndexPreparedFileIndexer,
} from "./CodeIndexPreparedFileIndexer";

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
  private readonly preparedIndexer:
    CodeIndexPreparedFileIndexer;

  constructor(
    private readonly reader:
      CodeIndexSourceReader,
    private readonly analyzer:
      CodeIndexSourceAnalyzer,
    private readonly hasher:
      CodeIndexContentHasher,
    mapper:
      CodeIndexDocumentMapper,
    updater:
      CodeIndexUpdater,
  ) {
    this.preparedIndexer =
      new CodeIndexPreparedFileIndexer(
        mapper,
        updater,
      );
  }

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
      return this.validateResult({
        status:
          "analysis_failed",
        analysis,
      });
    }

    /*
     * Hash the bytes that were actually analyzed. A snapshot hash can
     * become stale when the file changes between scanning and reading.
     */
    const contentHash =
      await this.hasher.hash(
        source.content,
      );

    return this.preparedIndexer
      .index({
        workspace:
          input.workspace,
        snapshot:
          input.snapshot,
        file:
          input.file,
        analysis,
        contentHash,
        analysisVersion:
          input.analysisVersion ??
          CODE_INDEXING_DEFAULTS
            .ANALYSIS_VERSION,
        indexedAt:
          input.indexedAt,
        ...(input.abortSignal
          ? {
              abortSignal:
                input.abortSignal,
            }
          : {}),
      });
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
