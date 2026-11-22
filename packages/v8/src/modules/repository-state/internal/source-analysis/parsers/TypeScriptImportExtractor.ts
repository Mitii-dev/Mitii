import * as ts from "typescript";

import {
  SOURCE_ANALYSIS_DEFAULTS,
} from "../constants";

import type {
  SourceAnalysisImport,
  SourceImportKind,
} from "../types";

import {
  positionOf,
  throwIfAborted,
} from "./TypeScriptAstUtils";

export function extractImports(
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
      positionOf(
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
    throwIfAborted(
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
        importedNamesFromClause(
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
        exportedNamesFromClause(
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

export function importedNamesFromClause(
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

export function exportedNamesFromClause(
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
