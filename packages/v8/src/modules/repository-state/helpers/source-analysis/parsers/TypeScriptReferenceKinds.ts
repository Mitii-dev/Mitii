import * as ts from "typescript";

import type {
  SourceReferenceKind,
} from "../types";

function heritageKind(
  node: ts.Identifier,
): "extends" | "implements" | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isHeritageClause(current)) {
      return current.token === ts.SyntaxKind.ImplementsKeyword
        ? "implements"
        : "extends";
    }
    if (
      ts.isClassDeclaration(current) ||
      ts.isClassExpression(current) ||
      ts.isInterfaceDeclaration(current)
    ) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

export function referenceKindOf(
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

  const heritage = heritageKind(node);
  if (heritage) {
    return heritage;
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

export function isInsideImportOrExport(
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
