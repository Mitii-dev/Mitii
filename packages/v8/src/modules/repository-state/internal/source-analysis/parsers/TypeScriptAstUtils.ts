import * as ts from "typescript";

import {
  SOURCE_ANALYSIS_DEFAULTS,
} from "../constants";

export function describeSymbolNode(
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
      readNodeName(
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
        readNodeName(
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
    shouldIncludeVariable(
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

function shouldIncludeVariable(
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
    isExported(statement)
  );
}

export function isExported(
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
    return isExported(
      node.parent.parent,
    );
  }

  return false;
}

export function readNodeName(
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

export function signatureOf(
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

export function positionOf(
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

export function resolveScriptKind(
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

export function getParseDiagnosticCount(
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

export function throwIfAborted(
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
