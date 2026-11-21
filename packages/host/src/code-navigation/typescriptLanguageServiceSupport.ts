import { statSync } from 'node:fs';
import { relative } from 'node:path';

import type ts from 'typescript';
import type { CodeNavigationLocation } from '@mitii/v8';

type TsApi = typeof ts;

export function getIdentifiersOnLine(
  api: TsApi,
  sourceFile: ts.SourceFile,
  targetLine: number,
): Array<{ offset: number; name: string }> {
  const identifiers: Array<{ offset: number; name: string }> = [];
  const visit = (node: ts.Node) => {
    if (api.isIdentifier(node)) {
      const lc = api.getLineAndCharacterOfPosition(
        sourceFile,
        node.getStart(sourceFile),
      );
      if (lc.line + 1 === targetLine) {
        identifiers.push({
          offset: node.getStart(sourceFile),
          name: node.text,
        });
      }
    }
    api.forEachChild(node, visit);
  };
  visit(sourceFile);
  return identifiers;
}

export function locationKey(location: CodeNavigationLocation): string {
  return [
    location.relativePath,
    String(location.startLine),
    String(location.startColumn ?? ''),
    location.symbolName ?? '',
  ].join('\0');
}

export function spanKey(fileName: string, span: ts.TextSpan): string {
  return [fileName, String(span.start), String(span.length)].join('\0');
}

export function scriptVersion(fileName: string): string {
  try {
    return String(statSync(fileName).mtimeMs);
  } catch {
    return '0';
  }
}

export function toRelative(
  workspaceRoot: string,
  fileName: string,
): string | undefined {
  const value = relative(workspaceRoot, fileName).replace(/\\/g, '/');
  if (!value || value.startsWith('../') || value === '..') return undefined;
  return value;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Code navigation aborted');
  error.name = 'AbortError';
  throw error;
}
