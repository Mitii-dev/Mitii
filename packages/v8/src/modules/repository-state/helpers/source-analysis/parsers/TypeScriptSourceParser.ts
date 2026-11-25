import * as ts from "typescript";

import {
  SOURCE_ANALYSIS_DEFAULTS,
  SOURCE_PARSER_IDS,
  SOURCE_PARSER_PRIORITIES,
  TYPESCRIPT_SOURCE_LANGUAGES,
} from "../constants";

import {
  SourceFactIdBuilder,
} from "../SourceFactIdBuilder";

import type {
  SourceAnalysisReference,
  SourceAnalysisSymbol,
  SourceParser,
  SourceParserInput,
  SourceParserResult,
} from "../types";

import {
  describeSymbolNode,
  getParseDiagnosticCount,
  isExported,
  positionOf,
  resolveScriptKind,
  signatureOf,
  throwIfAborted,
} from "./TypeScriptAstUtils";

import {
  extractImports,
} from "./TypeScriptImportExtractor";

import {
  isInsideImportOrExport,
  referenceKindOf,
} from "./TypeScriptReferenceKinds";

export class TypeScriptSourceParser
  implements SourceParser {
  public readonly id =
    SOURCE_PARSER_IDS.TYPESCRIPT;

  public readonly priority =
    SOURCE_PARSER_PRIORITIES
      .TYPESCRIPT;

  constructor(
    private readonly idBuilder:
      SourceFactIdBuilder =
        new SourceFactIdBuilder(),
  ) {}

  public supports(
    language: string,
    _relativePath: string,
  ): boolean {
    return TYPESCRIPT_SOURCE_LANGUAGES
      .has(language);
  }

  public async parse(
    input: SourceParserInput,
  ): Promise<SourceParserResult> {
    throwIfAborted(
      input.abortSignal,
    );

    const sourceFile =
      ts.createSourceFile(
        input.relativePath,
        input.content,
        ts.ScriptTarget.Latest,
        true,
        resolveScriptKind(
          input.relativePath,
        ),
      );

    const declarationPositions =
      new Set<number>();

    const symbols =
      this.extractSymbols(
        sourceFile,
        declarationPositions,
        input.abortSignal,
      );

    const imports =
      extractImports(
        sourceFile,
        input.abortSignal,
      );

    const references =
      this.extractReferences(
        sourceFile,
        declarationPositions,
        input.referenceCandidates,
        input.abortSignal,
      );

    const diagnosticCount =
      getParseDiagnosticCount(
        sourceFile,
      );

    return {
      parserId: this.id,
      language: input.language,
      quality: "precise",
      status:
        diagnosticCount > 0
          ? "partial"
          : "complete",
      symbols,
      imports,
      references,
      warnings:
        diagnosticCount > 0
          ? [
              {
                code:
                  "syntax_diagnostics",
                parserId: this.id,
                message:
                  `TypeScript parser reported ${diagnosticCount} syntax diagnostics.`,
              },
            ]
          : [],
    };
  }

  private extractSymbols(
    sourceFile: ts.SourceFile,
    declarationPositions:
      Set<number>,
    abortSignal?: AbortSignal,
  ): SourceAnalysisSymbol[] {
    const symbols:
      SourceAnalysisSymbol[] = [];

    const ordinalByBase =
      new Map<string, number>();

    const visit = (
      node: ts.Node,
      parentLocalId?: string,
    ): void => {
      throwIfAborted(
        abortSignal,
      );

      if (
        symbols.length >=
        SOURCE_ANALYSIS_DEFAULTS
          .MAXIMUM_SYMBOLS *
          SOURCE_ANALYSIS_DEFAULTS
            .PARSER_SAFETY_MULTIPLIER
      ) {
        return;
      }

      const descriptor =
        describeSymbolNode(
          node,
          sourceFile,
        );

      let nextParent =
        parentLocalId;

      if (descriptor) {
        declarationPositions.add(
          descriptor.nameNode.getStart(
            sourceFile,
          ),
        );

        const position =
          positionOf(
            sourceFile,
            node,
          );

        const ordinalKey = [
          descriptor.kind,
          descriptor.name,
          position.startLine,
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
              kind:
                descriptor.kind,
              name:
                descriptor.name,
              startLine:
                position.startLine,
              ordinal,
            });

        symbols.push({
          localId,
          name: descriptor.name,
          kind: descriptor.kind,

          ...(parentLocalId
            ? {
                parentLocalId,
              }
            : {}),

          exported:
            isExported(node),

          signature:
            signatureOf(
              node,
              sourceFile,
            ),

          ...position,
        });

        nextParent = localId;
      }

      ts.forEachChild(
        node,
        (child) =>
          visit(
            child,
            nextParent,
          ),
      );
    };

    visit(sourceFile);

    return symbols;
  }

  private extractReferences(
    sourceFile: ts.SourceFile,
    declarationPositions:
      ReadonlySet<number>,
    candidates:
      readonly string[] | undefined,
    abortSignal?: AbortSignal,
  ): SourceAnalysisReference[] {
    const references:
      SourceAnalysisReference[] = [];

    const candidateSet =
      candidates
        ? new Set(candidates)
        : undefined;

    const safetyLimit =
      SOURCE_ANALYSIS_DEFAULTS
        .MAXIMUM_REFERENCES *
      SOURCE_ANALYSIS_DEFAULTS
        .PARSER_SAFETY_MULTIPLIER;

    const visit = (
      node: ts.Node,
    ): void => {
      throwIfAborted(
        abortSignal,
      );

      if (
        references.length >=
        safetyLimit
      ) {
        return;
      }

      if (
        ts.isIdentifier(node) &&
        !declarationPositions.has(
          node.getStart(sourceFile),
        ) &&
        !isInsideImportOrExport(
          node,
        ) &&
        (!candidateSet ||
          candidateSet.has(
            node.text,
          ))
      ) {
        const position =
          positionOf(
            sourceFile,
            node,
          );

        references.push({
          symbolName:
            node.text,
          kind:
            referenceKindOf(
              node,
            ),
          line:
            position.startLine,
          column:
            position.startColumn,
        });
      }

      ts.forEachChild(
        node,
        visit,
      );
    };

    visit(sourceFile);

    return references;
  }
}
