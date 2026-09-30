import { relative } from 'node:path';

import type {
  CodeNavigationCapability,
  CodeNavigationDocumentQuery,
  CodeNavigationPort,
  CodeNavigationQuery,
  CodeNavigationWorkspaceQuery,
} from '@mitii/v8';

type CodeNavigationCallOptions = { signal?: AbortSignal };
import {
  CODE_NAVIGATION_OPERATIONS,
  CODE_NAVIGATION_POLICY,
  createRequestLimiter,
} from '@mitii/v8';
import type * as vscode from 'vscode';

export function createVsCodeCodeNavigationPort(
  vs: typeof vscode,
  workspaceRoot: string,
): CodeNavigationPort {
  const limit = createRequestLimiter({
    limit: CODE_NAVIGATION_POLICY.requestLimit,
    timeoutMs: CODE_NAVIGATION_POLICY.requestTimeoutMs,
  });

  const run = <T>(
    creator: () => Thenable<T> | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => limit(() => Promise.resolve(creator()), signal);

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
    prepare: async (
      relativePath: string,
      options?: CodeNavigationCallOptions,
    ) => {
      try {
        await run(
          () =>
            vs.workspace.openTextDocument(
              toUri(workspaceRoot, relativePath, vs),
            ),
          options?.signal,
        );
      } catch {
        // Missing files stay empty; navigation will report no_locations.
      }
    },
    definition: async (
      input: CodeNavigationQuery,
      options?: CodeNavigationCallOptions,
    ) => {
      const locations = await run(
        () =>
          vs.commands.executeCommand<
            readonly (vscode.Location | vscode.LocationLink)[] | undefined
          >(
            'vscode.executeDefinitionProvider',
            toUri(workspaceRoot, input.relativePath, vs),
            toPosition(input.line, input.column, vs),
          ),
        options?.signal,
      );
      return mapLocations(locations, workspaceRoot, vs);
    },
    typeDefinition: async (
      input: CodeNavigationQuery,
      options?: CodeNavigationCallOptions,
    ) => {
      const locations = await run(
        () =>
          vs.commands.executeCommand<
            readonly (vscode.Location | vscode.LocationLink)[] | undefined
          >(
            'vscode.executeTypeDefinitionProvider',
            toUri(workspaceRoot, input.relativePath, vs),
            toPosition(input.line, input.column, vs),
          ),
        options?.signal,
      );
      return mapLocations(locations, workspaceRoot, vs);
    },
    references: async (
      input: CodeNavigationQuery,
      options?: CodeNavigationCallOptions,
    ) => {
      const locations = await run(
        () =>
          vs.commands.executeCommand<
            readonly (vscode.Location | vscode.LocationLink)[] | undefined
          >(
            'vscode.executeReferenceProvider',
            toUri(workspaceRoot, input.relativePath, vs),
            toPosition(input.line, input.column, vs),
          ),
        options?.signal,
      );
      return mapLocations(locations, workspaceRoot, vs);
    },
    hover: async (
      input: CodeNavigationQuery,
      options?: CodeNavigationCallOptions,
    ) => {
      const hovers = await run(
        () =>
          vs.commands.executeCommand<readonly vscode.Hover[] | undefined>(
            'vscode.executeHoverProvider',
            toUri(workspaceRoot, input.relativePath, vs),
            toPosition(input.line, input.column, vs),
          ),
        options?.signal,
      );
      const contents = hovers
        ?.flatMap((hover) => hover.contents)
        .map((part) => (typeof part === 'string' ? part : part.value))
        .filter((value) => value.trim().length > 0)
        .join('\n\n');
      return contents ? { contents } : undefined;
    },
    documentSymbols: async (
      input: CodeNavigationDocumentQuery,
      options?: CodeNavigationCallOptions,
    ) => {
      const symbols = await run(
        () =>
          vs.commands.executeCommand<
            | readonly vscode.DocumentSymbol[]
            | readonly vscode.SymbolInformation[]
            | undefined
          >(
            'vscode.executeDocumentSymbolProvider',
            toUri(workspaceRoot, input.relativePath, vs),
          ),
        options?.signal,
      );
      return flattenDocumentSymbols(symbols, input.relativePath, workspaceRoot);
    },
    workspaceSymbols: async (
      input: CodeNavigationWorkspaceQuery,
      options?: CodeNavigationCallOptions,
    ) => {
      const symbols = await run(
        () =>
          vs.commands.executeCommand<
            readonly vscode.SymbolInformation[] | undefined
          >('vscode.executeWorkspaceSymbolProvider', input.query),
        options?.signal,
      );
      return mapSymbolInformation(symbols, workspaceRoot);
    },
    implementation: async (
      input: CodeNavigationQuery,
      options?: CodeNavigationCallOptions,
    ) => {
      const locations = await run(
        () =>
          vs.commands.executeCommand<
            readonly (vscode.Location | vscode.LocationLink)[] | undefined
          >(
            'vscode.executeImplementationProvider',
            toUri(workspaceRoot, input.relativePath, vs),
            toPosition(input.line, input.column, vs),
          ),
        options?.signal,
      );
      return mapLocations(locations, workspaceRoot, vs);
    },
    callHierarchy: async (
      input: CodeNavigationQuery,
      options?: CodeNavigationCallOptions,
    ) => {
      const items = await run(
        () =>
          vs.commands.executeCommand<
            readonly vscode.CallHierarchyItem[] | undefined
          >(
            'vscode.prepareCallHierarchy',
            toUri(workspaceRoot, input.relativePath, vs),
            toPosition(input.line, input.column, vs),
          ),
        options?.signal,
      );
      const root = items?.[0];
      if (!root) return [];
      if ((input.direction ?? 'outgoing') === 'incoming') {
        const calls = await run(
          () =>
            vs.commands.executeCommand<
              readonly vscode.CallHierarchyIncomingCall[] | undefined
            >('vscode.provideIncomingCalls', root),
          options?.signal,
        );
        return (calls ?? []).flatMap((call) =>
          mapHierarchyItem(call.from, workspaceRoot),
        );
      }
      const calls = await run(
        () =>
          vs.commands.executeCommand<
            readonly vscode.CallHierarchyOutgoingCall[] | undefined
          >('vscode.provideOutgoingCalls', root),
        options?.signal,
      );
      return (calls ?? []).flatMap((call) =>
        mapHierarchyItem(call.to, workspaceRoot),
      );
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

function isLocationLink(
  value: vscode.Location | vscode.LocationLink,
): value is vscode.LocationLink {
  return 'targetUri' in value;
}

/** Normalize Location | LocationLink the way IDE providers actually return them. */
function toLocation(
  value: vscode.Location | vscode.LocationLink,
  vs: typeof vscode,
): vscode.Location {
  return isLocationLink(value)
    ? new vs.Location(value.targetUri, value.targetRange)
    : value;
}

function mapLocations(
  locations: readonly (vscode.Location | vscode.LocationLink)[] | undefined,
  workspaceRoot: string,
  vs: typeof vscode,
): Array<{
  relativePath: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}> {
  if (!locations?.length) return [];
  const mapped = [];
  for (const entry of locations) {
    const location = toLocation(entry, vs);
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
  const relativePath = relative(workspaceRoot, item.uri.fsPath).replace(
    /\\/g,
    '/',
  );
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
    const relativePath = relative(
      workspaceRoot,
      symbol.location.uri.fsPath,
    ).replace(/\\/g, '/');
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
