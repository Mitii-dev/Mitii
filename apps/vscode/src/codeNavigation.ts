import { relative } from 'node:path';

import type {
  CodeNavigationCapability,
  CodeNavigationDocumentQuery,
  CodeNavigationPort,
  CodeNavigationQuery,
  CodeNavigationWorkspaceQuery,
} from '@mitii/v8';
import { CODE_NAVIGATION_OPERATIONS } from '@mitii/v8';
import type * as vscode from 'vscode';

export function createVsCodeCodeNavigationPort(
  vs: typeof vscode,
  workspaceRoot: string,
): CodeNavigationPort {
  return {
    id: 'vscode-language-server',
    provider: 'language_server',
    capability(): CodeNavigationCapability {
      return {
        status: 'available',
        provider: 'language_server',
        reason: 'language_server_attached',
        operations: CODE_NAVIGATION_OPERATIONS,
      };
    },
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
    documentSymbols: async (input: CodeNavigationDocumentQuery) => {
      const symbols = await vs.commands.executeCommand<
        readonly vscode.DocumentSymbol[] | readonly vscode.SymbolInformation[] | undefined
      >(
        'vscode.executeDocumentSymbolProvider',
        toUri(workspaceRoot, input.relativePath, vs),
      );
      return flattenDocumentSymbols(symbols, input.relativePath, workspaceRoot);
    },
    workspaceSymbols: async (input: CodeNavigationWorkspaceQuery) => {
      const symbols = await vs.commands.executeCommand<
        readonly vscode.SymbolInformation[] | undefined
      >('vscode.executeWorkspaceSymbolProvider', input.query);
      return mapSymbolInformation(symbols, workspaceRoot);
    },
    implementation: async (input: CodeNavigationQuery) => {
      const locations = await vs.commands.executeCommand<
        readonly vscode.Location[] | undefined
      >(
        'vscode.executeImplementationProvider',
        toUri(workspaceRoot, input.relativePath, vs),
        toPosition(input.line, input.column, vs),
      );
      return mapLocations(locations, workspaceRoot);
    },
    callHierarchy: async (input: CodeNavigationQuery) => {
      const items = await vs.commands.executeCommand<
        readonly vscode.CallHierarchyItem[] | undefined
      >(
        'vscode.prepareCallHierarchy',
        toUri(workspaceRoot, input.relativePath, vs),
        toPosition(input.line, input.column, vs),
      );
      const root = items?.[0];
      if (!root) return [];
      if ((input.direction ?? 'outgoing') === 'incoming') {
        const calls = await vs.commands.executeCommand<
          readonly vscode.CallHierarchyIncomingCall[] | undefined
        >('vscode.provideIncomingCalls', root);
        return (calls ?? []).flatMap((call) =>
          mapHierarchyItem(call.from, workspaceRoot),
        );
      }
      const calls = await vs.commands.executeCommand<
        readonly vscode.CallHierarchyOutgoingCall[] | undefined
      >('vscode.provideOutgoingCalls', root);
      return (calls ?? []).flatMap((call) => mapHierarchyItem(call.to, workspaceRoot));
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

function mapHierarchyItem(
  item: vscode.CallHierarchyItem,
  workspaceRoot: string,
): Array<{
  relativePath: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  symbolName?: string;
  symbolKind?: string;
}> {
  if (item.uri.scheme !== 'file') return [];
  const relativePath = relative(workspaceRoot, item.uri.fsPath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('../') || relativePath === '..') {
    return [];
  }
  return [
    {
      relativePath,
      startLine: item.selectionRange.start.line + 1,
      startColumn: item.selectionRange.start.character + 1,
      endLine: item.selectionRange.end.line + 1,
      endColumn: item.selectionRange.end.character + 1,
      symbolName: item.name,
      symbolKind: String(item.kind),
    },
  ];
}

function flattenDocumentSymbols(
  symbols:
    | readonly vscode.DocumentSymbol[]
    | readonly vscode.SymbolInformation[]
    | undefined,
  fallbackPath: string,
  workspaceRoot: string,
): Array<{
  relativePath: string;
  startLine: number;
  startColumn?: number;
  symbolName?: string;
  symbolKind?: string;
}> {
  if (!symbols?.length) return [];
  const mapped: Array<{
    relativePath: string;
    startLine: number;
    startColumn?: number;
    symbolName?: string;
    symbolKind?: string;
  }> = [];
  const walk = (
    items: readonly vscode.DocumentSymbol[] | readonly vscode.SymbolInformation[],
  ) => {
    for (const item of items) {
      if ('location' in item) {
        mapped.push(...mapSymbolInformation([item], workspaceRoot));
        continue;
      }
      mapped.push({
        relativePath: fallbackPath,
        startLine: item.selectionRange.start.line + 1,
        startColumn: item.selectionRange.start.character + 1,
        symbolName: item.name,
        symbolKind: String(item.kind),
      });
      if (item.children?.length) {
        walk(item.children);
      }
    }
  };
  walk(symbols);
  return mapped;
}

function mapSymbolInformation(
  symbols: readonly vscode.SymbolInformation[] | undefined,
  workspaceRoot: string,
): Array<{
  relativePath: string;
  startLine: number;
  startColumn?: number;
  symbolName?: string;
  symbolKind?: string;
}> {
  if (!symbols?.length) return [];
  const mapped = [];
  for (const symbol of symbols) {
    if (symbol.location.uri.scheme !== 'file') continue;
    const relativePath = relative(workspaceRoot, symbol.location.uri.fsPath).replace(
      /\\/g,
      '/',
    );
    if (!relativePath || relativePath.startsWith('../') || relativePath === '..') {
      continue;
    }
    mapped.push({
      relativePath,
      startLine: symbol.location.range.start.line + 1,
      startColumn: symbol.location.range.start.character + 1,
      symbolName: symbol.name,
      symbolKind: String(symbol.kind),
    });
  }
  return mapped;
}
