import {
  SOURCE_ANALYSIS_DEFAULTS,
  SOURCE_PARSER_IDS,
  SOURCE_PARSER_PRIORITIES,
  SOURCE_SYMBOL_KIND_BY_NODE_TYPE,
  SOURCE_TREE_SITTER_REFERENCE_QUERIES,
  SOURCE_TREE_SITTER_SYMBOL_QUERIES,
} from "../constants";

import {
  GenericImportExtractor,
} from "../extractors/GenericImportExtractor";

import {
  SourceFactIdBuilder,
} from "../SourceFactIdBuilder";

import type {
  SourceAnalysisImport,
  SourceAnalysisReference,
  SourceAnalysisSymbol,
  SourceParser,
  SourceParserInput,
  SourceParserResult,
  TreeSitterRuntimePort,
  TreeSitterRuntimeSymbol,
} from "../types";

export class TreeSitterSourceParser
  implements SourceParser {
  public readonly id =
    SOURCE_PARSER_IDS.TREE_SITTER;

  public readonly priority =
    SOURCE_PARSER_PRIORITIES
      .TREE_SITTER;

  constructor(
    private readonly runtime:
      TreeSitterRuntimePort,
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
      this.runtime.supports(
        language,
      ) &&
      SOURCE_TREE_SITTER_SYMBOL_QUERIES[
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

    const runtimeResult =
      await this.runtime.parse({
        language: input.language,
        relativePath:
          input.relativePath,
        content: input.content,

        ...(SOURCE_TREE_SITTER_SYMBOL_QUERIES[
          input.language
        ]
          ? {
              symbolQuery:
                SOURCE_TREE_SITTER_SYMBOL_QUERIES[
                  input.language
                ],
            }
          : {}),

        ...(SOURCE_TREE_SITTER_REFERENCE_QUERIES[
          input.language
        ]
          ? {
              referenceQuery:
                SOURCE_TREE_SITTER_REFERENCE_QUERIES[
                  input.language
                ],
            }
          : {}),
        maximumSymbols:
          SOURCE_ANALYSIS_DEFAULTS
            .MAXIMUM_SYMBOLS *
          SOURCE_ANALYSIS_DEFAULTS
            .PARSER_SAFETY_MULTIPLIER,
        maximumImports:
          SOURCE_ANALYSIS_DEFAULTS
            .MAXIMUM_IMPORTS *
          SOURCE_ANALYSIS_DEFAULTS
            .PARSER_SAFETY_MULTIPLIER,
        maximumReferences:
          SOURCE_ANALYSIS_DEFAULTS
            .MAXIMUM_REFERENCES *
          SOURCE_ANALYSIS_DEFAULTS
            .PARSER_SAFETY_MULTIPLIER,

        ...(input.abortSignal
          ? {
              abortSignal:
                input.abortSignal,
            }
          : {}),
      });

    this.throwIfAborted(
      input.abortSignal,
    );

    const symbols =
      this.mapSymbols(
        runtimeResult.symbols,
      );

    const imports =
      this.mergeImports(
        runtimeResult.imports ?? [],
        this.importExtractor.extract(
          input.content,
          input.abortSignal,
        ),
      );

    const candidateSet =
      input.referenceCandidates
        ? new Set(
            input.referenceCandidates,
          )
        : undefined;

    const references:
      SourceAnalysisReference[] =
      (runtimeResult.references ?? [])
        .filter(
          (reference) =>
            !candidateSet ||
            candidateSet.has(
              reference.symbolName,
            ),
        )
        .map((reference) => ({
          symbolName:
            reference.symbolName,
          kind:
            reference.kind ??
            "unknown",
          line: reference.line,

          ...(reference.column !==
          undefined
            ? {
                column:
                  reference.column,
              }
            : {}),
        }));

    const warnings =
      (runtimeResult.warnings ?? [])
        .map((message) => ({
          code:
            "parser_runtime_warning" as const,
          parserId: this.id,
          message:
            `Tree-sitter runtime "${this.runtime.id}": ${message}`,
        }));

    return {
      parserId: this.id,
      language: input.language,
      quality: "structural",
      status:
        warnings.length > 0
          ? "partial"
          : "complete",
      symbols,
      imports,
      references,
      warnings,
    };
  }

  private mapSymbols(
    values:
      readonly TreeSitterRuntimeSymbol[],
  ): SourceAnalysisSymbol[] {
    const symbols:
      SourceAnalysisSymbol[] = [];

    const ordinalByBase =
      new Map<string, number>();

    const localIdsByName =
      new Map<string, string[]>();

    for (const value of values) {
      const kind =
        this.kindFromNodeType(
          value.nodeType,
        );

      const ordinalKey = [
        kind,
        value.name,
        value.startLine,
      ].join("\u0000");

      const ordinal =
        ordinalByBase.get(
          ordinalKey,
        ) ?? 0;

      ordinalByBase.set(
        ordinalKey,
        ordinal + 1,
      );

      const localId =
        this.idBuilder
          .createSymbolLocalId({
            kind,
            name: value.name,
            startLine:
              value.startLine,
            ordinal,
          });

      const symbol:
        SourceAnalysisSymbol = {
        localId,
        name: value.name,
        kind,
        startLine:
          value.startLine,

        ...(value.exported !==
        undefined
          ? {
              exported:
                value.exported,
            }
          : {}),

        ...(value.signature
          ? {
              signature:
                value.signature.slice(
                  0,
                  SOURCE_ANALYSIS_DEFAULTS
                    .MAXIMUM_SIGNATURE_CHARACTERS,
                ),
            }
          : {}),

        ...(value.endLine !==
        undefined
          ? {
              endLine:
                value.endLine,
            }
          : {}),

        ...(value.startColumn !==
        undefined
          ? {
              startColumn:
                value.startColumn,
            }
          : {}),

        ...(value.endColumn !==
        undefined
          ? {
              endColumn:
                value.endColumn,
            }
          : {}),
      };

      symbols.push(symbol);

      const ids =
        localIdsByName.get(
          value.name,
        ) ?? [];

      ids.push(localId);

      localIdsByName.set(
        value.name,
        ids,
      );
    }

    for (
      let index = 0;
      index < values.length;
      index += 1
    ) {
      const parentName =
        values[index]?.parentName;

      if (!parentName) {
        continue;
      }

      const parentIds =
        localIdsByName.get(
          parentName,
        );

      const symbol =
        symbols[index];

      const parentId =
        parentIds?.[0];

      if (
        symbol &&
        parentIds?.length === 1 &&
        parentId &&
        parentId !==
          symbol.localId
      ) {
        symbol.parentLocalId =
          parentId;
      }
    }

    return symbols;
  }

  private mergeImports(
    runtimeImports:
      readonly {
        specifier: string;
        kind?: SourceAnalysisImport["kind"];
        importedNames?:
          readonly string[];
        line: number;
        column?: number;
      }[],
    fallbackImports:
      readonly SourceAnalysisImport[],
  ): SourceAnalysisImport[] {
    return [
      ...runtimeImports.map(
        (item): SourceAnalysisImport => ({
          specifier:
            item.specifier,
          kind:
            item.kind ?? "unknown",
          importedNames:
            [...new Set(
              item.importedNames ?? [],
            )].sort(),
          line: item.line,

          ...(item.column !==
          undefined
            ? {
                column:
                  item.column,
              }
            : {}),
        }),
      ),
      ...fallbackImports,
    ];
  }

  private kindFromNodeType(
    nodeType: string,
  ): string {
    const exact =
      SOURCE_SYMBOL_KIND_BY_NODE_TYPE[
        nodeType
      ];

    if (exact) {
      return exact;
    }

    const normalized =
      nodeType.toLowerCase();

    for (
      const [
        fragment,
        kind,
      ] of Object.entries(
        SOURCE_SYMBOL_KIND_BY_NODE_TYPE,
      )
    ) {
      if (
        normalized.includes(
          fragment,
        )
      ) {
        return kind;
      }
    }

    return "symbol";
  }

  private throwIfAborted(
    abortSignal?: AbortSignal,
  ): void {
    if (!abortSignal?.aborted) {
      return;
    }

    const error = new Error(
      "Tree-sitter source parsing was aborted.",
    );

    error.name = "AbortError";

    throw error;
  }
}
