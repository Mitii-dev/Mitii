import {
  SOURCE_ANALYSIS_SCHEMA_VERSION,
  resolveSourceAnalysisBuilderOptions,
} from "./constants";

import {
  LanguageDetector,
} from "./LanguageDetector";

import {
  sourceAnalysisSchema,
  sourceParserResultSchema,
} from "./schema";

import {
  SourceAnalysisNormalizer,
} from "./SourceAnalysisNormalizer";

import {
  SourceParserRegistry,
} from "./parsers/SourceParserRegistry";

import type {
  SourceAnalysis,
  SourceAnalysisBuilderOptions,
  SourceAnalysisInput,
  SourceAnalysisWarning,
  SourceLanguageDetection,
  SourceParserInput,
  SourceParserResult,
} from "./types";

export class SourceAnalysisBuilder {
  private readonly options:
    Required<SourceAnalysisBuilderOptions>;

  constructor(
    private readonly registry:
      SourceParserRegistry,
    private readonly languageDetector:
      LanguageDetector =
        new LanguageDetector(),
    private readonly normalizer:
      SourceAnalysisNormalizer =
        new SourceAnalysisNormalizer(),
    options:
      SourceAnalysisBuilderOptions = {},
  ) {
    this.options =
      resolveSourceAnalysisBuilderOptions(
        options,
      );
  }

  public async analyze(
    input: SourceAnalysisInput,
  ): Promise<SourceAnalysis> {
    this.validateInput(input);

    this.throwIfAborted(
      input.abortSignal,
    );

    const languageDetection =
      this.languageDetector.detect(
        input.file.relativePath,
        input.language,
      );

    if (
      !languageDetection.language
    ) {
      return this.validateOutput(
        this.createTerminalResult({
          input,
          languageDetection,
          status: "unsupported",
          warning: {
            code:
              "language_unknown",
            message:
              languageDetection
                .evidence,
          },
        }),
      );
    }

    const resolution =
      this.registry.resolve(
        languageDetection.language,
        input.file.relativePath,
      );

    if (
      resolution.parsers.length === 0
    ) {
      return this.validateOutput(
        this.createTerminalResult({
          input,
          languageDetection,
          status: "unsupported",
          warning: {
            code:
              "parser_not_found",
            message:
              `No source parser supports language "${languageDetection.language}".`,
          },
        }),
      );
    }

    const precedingWarnings:
      SourceAnalysisWarning[] = [];

    const parserInput:
      SourceParserInput = {
      sourceId: input.sourceId,
      rootId: input.file.rootId,
      relativePath:
        input.file.relativePath,
      language:
        languageDetection.language,
      content: input.content,

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
    };

    for (
      let index = 0;
      index <
      resolution.parsers.length;
      index += 1
    ) {
      const parser =
        resolution.parsers[index];

      if (!parser) {
        continue;
      }

      this.throwIfAborted(
        input.abortSignal,
      );

      let rawResult: unknown;

      try {
        rawResult =
          await parser.parse(
            parserInput,
          );
      } catch (error) {
        if (
          this.isAbortError(error)
        ) {
          throw error;
        }

        precedingWarnings.push({
          code: "parser_failed",
          parserId: parser.id,
          message:
            `Source parser "${parser.id}" failed: ${this.errorMessage(error)}`,
        });

        continue;
      }

      const validation =
        sourceParserResultSchema
          .safeParse(rawResult);

      if (!validation.success) {
        precedingWarnings.push({
          code:
            "parser_result_invalid",
          parserId: parser.id,
          message:
            `Source parser "${parser.id}" returned an invalid result.`,
        });

        continue;
      }

      const parserResult =
        validation.data as unknown as
          SourceParserResult;

      if (
        parserResult.parserId !==
          parser.id ||
        parserResult.language !==
          languageDetection.language
      ) {
        precedingWarnings.push({
          code:
            "parser_result_invalid",
          parserId: parser.id,
          message:
            `Source parser "${parser.id}" returned mismatched parser or language identity.`,
        });

        continue;
      }

      const hasFacts =
        parserResult.symbols.length >
          0 ||
        parserResult.imports.length >
          0 ||
        parserResult.references
          .length > 0;

      const hasFallback =
        index + 1 <
        resolution.parsers.length;

      if (
        input.content.trim() &&
        !hasFacts &&
        hasFallback &&
        this.options
          .fallbackOnEmptyResult
      ) {
        precedingWarnings.push({
          code:
            "parser_returned_empty",
          parserId: parser.id,
          message:
            `Source parser "${parser.id}" returned no facts; the next parser was attempted.`,
        });

        continue;
      }

      return this.validateOutput(
        this.normalizer.normalize({
          sourceId:
            input.sourceId,
          rootId:
            input.file.rootId,
          relativePath:
            input.file.relativePath,
          language:
            languageDetection
              .language,
          languageSource:
            languageDetection.source,
          parserResult,
          precedingWarnings,
        }),
      );
    }

    return this.validateOutput(
      this.createTerminalResult({
        input,
        languageDetection,
        status: "failed",
        warnings:
          precedingWarnings.length > 0
            ? precedingWarnings
            : [
                {
                  code:
                    "parser_failed",
                  message:
                    "Every matching source parser failed.",
                },
              ],
      }),
    );
  }

  private createTerminalResult(
    values: {
      input: SourceAnalysisInput;
      languageDetection:
        SourceLanguageDetection;
      status:
        | "unsupported"
        | "failed";
      warning?:
        SourceAnalysisWarning;
      warnings?:
        readonly SourceAnalysisWarning[];
    },
  ): SourceAnalysis {
    const warnings = [
      ...(values.warnings ?? []),
      ...(values.warning
        ? [values.warning]
        : []),
    ];

    return {
      schemaVersion:
        SOURCE_ANALYSIS_SCHEMA_VERSION,
      sourceId:
        values.input.sourceId,
      rootId:
        values.input.file.rootId,
      relativePath:
        values.input.file
          .relativePath,

      ...(values.languageDetection
        .language
        ? {
            language:
              values
                .languageDetection
                .language,
          }
        : {}),

      languageSource:
        values.languageDetection
          .source,
      quality: "none",
      status: values.status,
      symbols: [],
      imports: [],
      references: [],
      warnings,
    };
  }

  private validateInput(
    input: SourceAnalysisInput,
  ): void {
    if (!input.sourceId.trim()) {
      throw new RangeError(
        "SourceAnalysisInput.sourceId cannot be empty.",
      );
    }

    if (
      input.file.kind !== "file"
    ) {
      throw new TypeError(
        "SourceAnalysisBuilder requires a WorkspaceFileEntry.",
      );
    }

    if (
      !input.file.rootId.trim() ||
      !input.file.relativePath.trim()
    ) {
      throw new RangeError(
        "Source analysis requires rootId and relativePath.",
      );
    }

    if (
      input.referenceCandidates &&
      new Set(
        input.referenceCandidates,
      ).size !==
        input.referenceCandidates.length
    ) {
      throw new RangeError(
        "referenceCandidates must be unique.",
      );
    }
  }

  private validateOutput(
    analysis: SourceAnalysis,
  ): SourceAnalysis {
    return sourceAnalysisSchema.parse(
      analysis,
    ) as SourceAnalysis;
  }

  private throwIfAborted(
    abortSignal?: AbortSignal,
  ): void {
    if (!abortSignal?.aborted) {
      return;
    }

    const error = new Error(
      "Source analysis was aborted.",
    );

    error.name = "AbortError";

    throw error;
  }

  private isAbortError(
    error: unknown,
  ): boolean {
    return (
      error instanceof Error &&
      error.name === "AbortError"
    );
  }

  private errorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : String(error);
  }
}
