import {
  SOURCE_ANALYSIS_DEFAULTS,
  SOURCE_PARSER_IDS,
  SOURCE_PARSER_PRIORITIES,
  SOURCE_REGEX_SYMBOL_PATTERNS,
} from "../constants";

import {
  SourceFactIdBuilder,
} from "../SourceFactIdBuilder";

import {
  GenericImportExtractor,
} from "../extractors/GenericImportExtractor";

import type {
  SourceAnalysisReference,
  SourceAnalysisSymbol,
  SourceParser,
  SourceParserInput,
  SourceParserResult,
} from "../types";

export class RegexSourceParser
  implements SourceParser {
  public readonly id =
    SOURCE_PARSER_IDS.REGEX;

  public readonly priority =
    SOURCE_PARSER_PRIORITIES.REGEX;

  constructor(
    private readonly idBuilder:
      SourceFactIdBuilder =
        new SourceFactIdBuilder(),
    private readonly importExtractor:
      GenericImportExtractor =
        new GenericImportExtractor(),
  ) {}

  public supports(
    language: string,
    _relativePath: string,
  ): boolean {
    return (
      SOURCE_REGEX_SYMBOL_PATTERNS[
        language
      ] !== undefined
    );
  }

  public async parse(
    input: SourceParserInput,
  ): Promise<SourceParserResult> {
    this.throwIfAborted(
      input.abortSignal,
    );

    const lines =
      input.content.split(/\r?\n/);

    return {
      parserId: this.id,
      language: input.language,
      quality: "heuristic",
      status: "complete",
      symbols:
        this.extractSymbols(
          lines,
          input.language,
          input.abortSignal,
        ),
      imports:
        this.importExtractor.extract(
          input.content,
          input.abortSignal,
        ),
      references:
        this.extractReferences(
          lines,
          input.referenceCandidates,
          input.abortSignal,
        ),
      warnings: [],
    };
  }

  private extractSymbols(
    lines: readonly string[],
    language: string,
    abortSignal?: AbortSignal,
  ): SourceAnalysisSymbol[] {
    const patterns =
      SOURCE_REGEX_SYMBOL_PATTERNS[
        language
      ] ?? [];

    const symbols:
      SourceAnalysisSymbol[] = [];

    const ordinalByBase =
      new Map<string, number>();

    const safetyLimit =
      SOURCE_ANALYSIS_DEFAULTS
        .MAXIMUM_SYMBOLS *
      SOURCE_ANALYSIS_DEFAULTS
        .PARSER_SAFETY_MULTIPLIER;

    for (
      let index = 0;
      index < lines.length;
      index += 1
    ) {
      this.throwIfAborted(
        abortSignal,
      );

      if (
        symbols.length >=
        safetyLimit
      ) {
        break;
      }

      const sourceLine =
        lines[index] ?? "";

      const trimmed =
        sourceLine.trim();

      for (const definition of patterns) {
        const match =
          definition.pattern.exec(
            trimmed,
          );

        if (!match) {
          continue;
        }

        const name =
          (
            match[1] ??
            match[0]
          ).trim();

        if (
          name.length <
          SOURCE_ANALYSIS_DEFAULTS
            .MINIMUM_REFERENCE_NAME_LENGTH
        ) {
          continue;
        }

        const startLine =
          index + 1;

        const ordinalKey = [
          definition.kind,
          name,
          startLine,
        ].join("\u0000");

        const ordinal =
          ordinalByBase.get(
            ordinalKey,
          ) ?? 0;

        ordinalByBase.set(
          ordinalKey,
          ordinal + 1,
        );

        symbols.push({
          localId:
            this.idBuilder
              .createSymbolLocalId({
                kind:
                  definition.kind,
                name,
                startLine,
                ordinal,
              }),
          name,
          kind:
            definition.kind,
          exported:
            /^export\b/.test(
              trimmed,
            ) ||
            /^pub\b/.test(trimmed),
          signature:
            trimmed.slice(
              0,
              SOURCE_ANALYSIS_DEFAULTS
                .MAXIMUM_SIGNATURE_CHARACTERS,
            ),
          startLine,
          endLine: startLine,
          startColumn:
            sourceLine.indexOf(
              name,
            ) + 1,
        });
      }
    }

    return symbols;
  }

  private extractReferences(
    lines: readonly string[],
    candidates:
      readonly string[] | undefined,
    abortSignal?: AbortSignal,
  ): SourceAnalysisReference[] {
    if (
      !candidates ||
      candidates.length === 0
    ) {
      return [];
    }

    const references:
      SourceAnalysisReference[] = [];

    const uniqueCandidates =
      [...new Set(
        candidates
          .map((value) =>
            value.trim(),
          )
          .filter(
            (value) =>
              value.length >=
              SOURCE_ANALYSIS_DEFAULTS
                .MINIMUM_REFERENCE_NAME_LENGTH,
          ),
      )].sort(
        (left, right) =>
          right.length -
            left.length ||
          left.localeCompare(right),
      );

    const safetyLimit =
      SOURCE_ANALYSIS_DEFAULTS
        .MAXIMUM_REFERENCES *
      SOURCE_ANALYSIS_DEFAULTS
        .PARSER_SAFETY_MULTIPLIER;

    for (
      let index = 0;
      index < lines.length;
      index += 1
    ) {
      this.throwIfAborted(
        abortSignal,
      );

      const line =
        lines[index] ?? "";

      for (
        const candidate of
        uniqueCandidates
      ) {
        const pattern =
          new RegExp(
            `\\b${this.escapeRegex(
              candidate,
            )}\\b`,
            "g",
          );

        let match:
          RegExpExecArray | null;

        while (
          (match =
            pattern.exec(line)) !==
          null
        ) {
          references.push({
            symbolName:
              candidate,
            kind:
              this.guessReferenceKind(
                line,
                match.index,
                candidate.length,
              ),
            line: index + 1,
            column:
              match.index + 1,
          });

          if (
            references.length >=
            safetyLimit
          ) {
            return references;
          }
        }
      }
    }

    return references;
  }

  private guessReferenceKind(
    line: string,
    start: number,
    length: number,
  ):
    | "call"
    | "construct"
    | "read" {
    const after =
      line
        .slice(start + length)
        .trimStart();

    if (after.startsWith("(")) {
      const before =
        line
          .slice(0, start)
          .trimEnd();

      return /\bnew$/.test(before)
        ? "construct"
        : "call";
    }

    return "read";
  }

  private escapeRegex(
    value: string,
  ): string {
    return value.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
  }

  private throwIfAborted(
    abortSignal?: AbortSignal,
  ): void {
    if (!abortSignal?.aborted) {
      return;
    }

    const error = new Error(
      "Regex source parsing was aborted.",
    );

    error.name = "AbortError";

    throw error;
  }
}
