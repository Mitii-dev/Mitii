import { relative } from 'node:path';

import type {
  CodeNavigationPort,
  CodeNavigationQuery,
} from '@mitii/v8';
import type * as vscode from 'vscode';

export function createVsCodeCodeNavigationPort(
  vs: typeof vscode,
  workspaceRoot: string,
): CodeNavigationPort {
  return {
    id: 'vscode-language-server',
    provider: 'language_server',
    definition: async (input: CodeNavigationQuery) => {
      const locations = await vs.commands.executeCommand<
        readonly vscode.Location[] | undefined
      >(
        'vscode.executeDefinitionProvider',
        toUri(workspaceRoot, input.relativePath, vs),
        toPosition(input.line, input.column, vs),
      );
      return mapLocations(locations, workspaceRoot);
    },
    references: async (input: CodeNavigationQuery) => {
      const locations = await vs.commands.executeCommand<
        readonly vscode.Location[] | undefined
      >(
        'vscode.executeReferenceProvider',
        toUri(workspaceRoot, input.relativePath, vs),
        toPosition(input.line, input.column, vs),
      );
      return mapLocations(locations, workspaceRoot);
    },
    hover: async (input: CodeNavigationQuery) => {
      const hovers = await vs.commands.executeCommand<
        readonly vscode.Hover[] | undefined
      >(
        'vscode.executeHoverProvider',
        toUri(workspaceRoot, input.relativePath, vs),
        toPosition(input.line, input.column, vs),
      );
      const contents = hovers
        ?.flatMap((hover) => hover.contents)
        .map((part) => (typeof part === 'string' ? part : part.value))
        .filter((value) => value.trim().length > 0)
        .join('\n\n');
      return contents ? { contents } : undefined;
    },
  };
}

function toUri(
  workspaceRoot: string,
  relativePath: string,
  vs: typeof vscode,
): vscode.Uri {
  return vs.Uri.file(
    `${workspaceRoot.replace(/\\/g, '/')}/${relativePath.replace(/\\/g, '/')}`,
  );
}

function toPosition(
  line: number,
  column: number,
  vs: typeof vscode,
): vscode.Position {
  return new vs.Position(Math.max(0, line - 1), Math.max(0, column - 1));
}

function mapLocations(
  locations: readonly vscode.Location[] | undefined,
  workspaceRoot: string,
): Array<{
  relativePath: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}> {
  if (!locations?.length) return [];
  const mapped = [];
  for (const location of locations) {
    if (location.uri.scheme !== 'file') continue;
    const relativePath = relative(workspaceRoot, location.uri.fsPath).replace(
      /\\/g,
      '/',
    );
    if (
      !relativePath ||
      relativePath.startsWith('../') ||
      relativePath === '..'
    ) {
      continue;
    }
    mapped.push({
      relativePath,
      startLine: location.range.start.line + 1,
      startColumn: location.range.start.character + 1,
      endLine: location.range.end.line + 1,
      endColumn: location.range.end.character + 1,
    });
  }
  return mapped;
}
