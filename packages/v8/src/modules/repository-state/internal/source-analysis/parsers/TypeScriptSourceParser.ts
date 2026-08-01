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
  SourceAnalysisImport,
  SourceAnalysisReference,
  SourceAnalysisSymbol,
  SourceImportKind,
  SourceParser,
  SourceParserInput,
  SourceParserResult,
  SourceReferenceKind,
} from "../types";

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
    this.throwIfAborted(
      input.abortSignal,
    );

    const sourceFile =
      ts.createSourceFile(
        input.relativePath,
        input.content,
        ts.ScriptTarget.Latest,
        true,
        this.resolveScriptKind(
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
      this.extractImports(
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
      this.getParseDiagnosticCount(
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
      this.throwIfAborted(
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
        this.describeSymbolNode(
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
          this.positionOf(
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
            this.isExported(node),

          signature:
            this.signatureOf(
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

  private describeSymbolNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
  ):
    | {
        name: string;
        kind: string;
        nameNode: ts.Node;
      }
    | undefined {
    if (
      ts.isClassDeclaration(node) &&
      node.name
    ) {
      return {
        name: node.name.text,
        kind: "class",
        nameNode: node.name,
      };
    }

    if (
      ts.isInterfaceDeclaration(node)
    ) {
      return {
        name: node.name.text,
        kind: "interface",
        nameNode: node.name,
      };
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name
    ) {
      return {
        name: node.name.text,
        kind: "function",
        nameNode: node.name,
      };
    }

    if (
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node)
    ) {
      const name =
        this.readNodeName(
          node.name,
          sourceFile,
        );

      return name
        ? {
            name,
            kind: "method",
            nameNode: node.name,
          }
        : undefined;
    }

    if (
      ts.isTypeAliasDeclaration(node)
    ) {
      return {
        name: node.name.text,
        kind: "type",
        nameNode: node.name,
      };
    }

    if (
      ts.isEnumDeclaration(node)
    ) {
      return {
        name: node.name.text,
        kind: "enum",
        nameNode: node.name,
      };
    }

    if (
      ts.isModuleDeclaration(node)
    ) {
      return {
        name:
          this.readNodeName(
            node.name,
            sourceFile,
          ) ??
          node.name.getText(
            sourceFile,
          ),
        kind: "module",
        nameNode: node.name,
      };
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      this.shouldIncludeVariable(
        node,
      )
    ) {
      return {
        name: node.name.text,
        kind:
          node.initializer &&
          (ts.isArrowFunction(
            node.initializer,
          ) ||
            ts.isFunctionExpression(
              node.initializer,
            ))
            ? "function"
            : "const",
        nameNode: node.name,
      };
    }

    return undefined;
  }

  private shouldIncludeVariable(
    node: ts.VariableDeclaration,
  ): boolean {
    const declarationList =
      node.parent;

    const statement =
      declarationList.parent;

    return (
      ts.isSourceFile(
        statement.parent,
      ) ||
      this.isExported(statement)
    );
  }

  private extractImports(
    sourceFile: ts.SourceFile,
    abortSignal?: AbortSignal,
  ): SourceAnalysisImport[] {
    const imports:
      SourceAnalysisImport[] = [];

    const safetyLimit =
      SOURCE_ANALYSIS_DEFAULTS
        .MAXIMUM_IMPORTS *
      SOURCE_ANALYSIS_DEFAULTS
        .PARSER_SAFETY_MULTIPLIER;

    const addImport = (
      node: ts.Node,
      specifier: string,
      kind: SourceImportKind,
      importedNames:
        readonly string[],
    ): void => {
      if (
        imports.length >=
        safetyLimit
      ) {
        return;
      }

      const position =
        this.positionOf(
          sourceFile,
          node,
        );

      imports.push({
        specifier,
        kind,
        importedNames:
          [...new Set(
            importedNames
              .map((value) =>
                value.trim(),
              )
              .filter(Boolean),
          )].sort(),
        line:
          position.startLine,
        column:
          position.startColumn,
      });
    };

    const visit = (
      node: ts.Node,
    ): void => {
      this.throwIfAborted(
        abortSignal,
      );

      if (
        ts.isImportDeclaration(
          node,
        ) &&
        ts.isStringLiteralLike(
          node.moduleSpecifier,
        )
      ) {
        addImport(
          node,
          node.moduleSpecifier.text,
          "static",
          this.importedNamesFromClause(
            node.importClause,
          ),
        );
      } else if (
        ts.isExportDeclaration(
          node,
        ) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(
          node.moduleSpecifier,
        )
      ) {
        addImport(
          node,
          node.moduleSpecifier.text,
          "reexport",
          this.exportedNamesFromClause(
            node.exportClause,
          ),
        );
      } else if (
        ts.isCallExpression(node) &&
        node.arguments.length > 0
      ) {
        const firstArgument =
          node.arguments[0];

        if (
          firstArgument &&
          ts.isStringLiteralLike(
            firstArgument,
          )
        ) {
          if (
            node.expression.kind ===
            ts.SyntaxKind.ImportKeyword
          ) {
            addImport(
              node,
              firstArgument.text,
              "dynamic",
              [],
            );
          } else if (
            ts.isIdentifier(
              node.expression,
            ) &&
            node.expression.text ===
              "require"
          ) {
            addImport(
              node,
              firstArgument.text,
              "require",
              [],
            );
          }
        }
      }

      if (
        imports.length <
        safetyLimit
      ) {
        ts.forEachChild(
          node,
          visit,
        );
      }
    };

    visit(sourceFile);

    return imports;
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
      this.throwIfAborted(
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
        !this.isInsideImportOrExport(
          node,
        ) &&
        (!candidateSet ||
          candidateSet.has(
            node.text,
          ))
      ) {
        const position =
          this.positionOf(
            sourceFile,
            node,
          );

        references.push({
          symbolName:
            node.text,
          kind:
            this.referenceKindOf(
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

  private referenceKindOf(
    node: ts.Identifier,
  ): SourceReferenceKind {
    const parent = node.parent;

    if (
      ts.isCallExpression(parent) &&
      parent.expression === node
    ) {
      return "call";
    }

    if (
      ts.isNewExpression(parent) &&
      parent.expression === node
    ) {
      return "construct";
    }

    if (
      ts.isTypeReferenceNode(
        parent,
      ) ||
      ts.isExpressionWithTypeArguments(
        parent,
      )
    ) {
      return "type";
    }

    if (
      ts.isBinaryExpression(
        parent,
      ) &&
      parent.left === node &&
      parent.operatorToken.kind >=
        ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <=
        ts.SyntaxKind.LastAssignment
    ) {
      return "write";
    }

    return "read";
  }

  private isInsideImportOrExport(
    node: ts.Node,
  ): boolean {
    let current:
      ts.Node | undefined = node;

    while (
      current &&
      !ts.isSourceFile(current)
    ) {
      if (
        ts.isImportDeclaration(
          current,
        ) ||
        ts.isImportClause(current) ||
        ts.isImportSpecifier(
          current,
        ) ||
        ts.isExportDeclaration(
          current,
        ) ||
        ts.isExportSpecifier(
          current,
        )
      ) {
        return true;
      }

      current = current.parent;
    }

    return false;
  }

  private importedNamesFromClause(
    clause:
      ts.ImportClause | undefined,
  ): string[] {
    if (!clause) {
      return [];
    }

    const names: string[] = [];

    if (clause.name) {
      names.push("default");
    }

    const bindings =
      clause.namedBindings;

    if (
      bindings &&
      ts.isNamespaceImport(bindings)
    ) {
      names.push("*");
    } else if (
      bindings &&
      ts.isNamedImports(bindings)
    ) {
      for (
        const element of
        bindings.elements
      ) {
        names.push(
          element.propertyName
            ?.text ??
            element.name.text,
        );
      }
    }

    return names;
  }

  private exportedNamesFromClause(
    clause:
      ts.NamedExportBindings | undefined,
  ): string[] {
    if (!clause) {
      return ["*"];
    }

    if (
      ts.isNamespaceExport(clause)
    ) {
      return ["*"];
    }

    return clause.elements.map(
      (element) =>
        element.propertyName
          ?.text ??
        element.name.text,
    );
  }

  private isExported(
    node: ts.Node,
  ): boolean {
    const modifiers =
      ts.canHaveModifiers(node)
        ? ts.getModifiers(node)
        : undefined;

    if (
      modifiers?.some(
        (modifier) =>
          modifier.kind ===
          ts.SyntaxKind.ExportKeyword,
      )
    ) {
      return true;
    }

    if (
      ts.isVariableDeclaration(node)
    ) {
      return this.isExported(
        node.parent.parent,
      );
    }

    return false;
  }

  private signatureOf(
    node: ts.Node,
    sourceFile: ts.SourceFile,
  ): string {
    return node
      .getText(sourceFile)
      .split(/\r?\n/)
      .slice(
        0,
        SOURCE_ANALYSIS_DEFAULTS
          .MAXIMUM_SIGNATURE_LINES,
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(
        0,
        SOURCE_ANALYSIS_DEFAULTS
          .MAXIMUM_SIGNATURE_CHARACTERS,
      );
  }

  private positionOf(
    sourceFile: ts.SourceFile,
    node: ts.Node,
  ): {
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  } {
    const start =
      sourceFile
        .getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );

    const end =
      sourceFile
        .getLineAndCharacterOfPosition(
          node.getEnd(),
        );

    return {
      startLine:
        start.line + 1,
      endLine:
        end.line + 1,
      startColumn:
        start.character + 1,
      endColumn:
        end.character + 1,
    };
  }

  private readNodeName(
    node: ts.PropertyName,
    sourceFile: ts.SourceFile,
  ): string | undefined {
    if (
      ts.isIdentifier(node) ||
      ts.isStringLiteralLike(node) ||
      ts.isNumericLiteral(node)
    ) {
      return node.text;
    }

    const text =
      node
        .getText(sourceFile)
        .trim();

    return text || undefined;
  }

  private resolveScriptKind(
    relativePath: string,
  ): ts.ScriptKind {
    const path =
      relativePath.toLowerCase();

    if (path.endsWith(".tsx")) {
      return ts.ScriptKind.TSX;
    }

    if (path.endsWith(".jsx")) {
      return ts.ScriptKind.JSX;
    }

    if (
      path.endsWith(".js") ||
      path.endsWith(".mjs") ||
      path.endsWith(".cjs")
    ) {
      return ts.ScriptKind.JS;
    }

    return ts.ScriptKind.TS;
  }

  private getParseDiagnosticCount(
    sourceFile: ts.SourceFile,
  ): number {
    const withDiagnostics =
      sourceFile as ts.SourceFile & {
        parseDiagnostics?:
          readonly ts.Diagnostic[];
      };

    return (
      withDiagnostics
        .parseDiagnostics?.length ?? 0
    );
  }

  private throwIfAborted(
    abortSignal?: AbortSignal,
  ): void {
    if (!abortSignal?.aborted) {
      return;
    }

    const error = new Error(
      "TypeScript source parsing was aborted.",
    );

    error.name = "AbortError";

    throw error;
  }
}

