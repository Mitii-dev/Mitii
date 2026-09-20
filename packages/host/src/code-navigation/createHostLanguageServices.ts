import { relative, resolve, sep } from 'node:path';
import { statSync } from 'node:fs';

import ts from 'typescript';
import type {
  CodeNavigationCapability,
  CodeNavigationDocumentQuery,
  CodeNavigationHover,
  CodeNavigationLocation,
  CodeNavigationPort,
  CodeNavigationQuery,
  CodeNavigationWorkspaceQuery,
  DiagnosticItem,
  DiagnosticsPort,
} from '@mitii/v8';
import { CODE_NAVIGATION_OPERATIONS } from '@mitii/v8';

import { createHostCodeNavigationPort } from './createHostCodeNavigationPort.js';

const MAX_LOCATIONS = 40;

/**
 * CLI/ACP-owned language-service lifecycle.
 *
 * V8 must not spawn servers. This host creates a TypeScript language service
 * when `tsconfig.json` exists (`available`) and otherwise leaves navigation on
 * the repo graph (`degraded`). Diagnostics are the same service so apply_patch
 * can surface new errors without a separate model call.
 */
export interface HostLanguageServices {
  codeNavigation: CodeNavigationPort;
  diagnostics?: DiagnosticsPort;
  capability: CodeNavigationCapability;
  dispose(): void;
}

export function createHostLanguageServices(options: {
  workspaceRoot: string;
}): HostLanguageServices {
  const service = tryCreateTypeScriptLanguageService(options.workspaceRoot);
  if (!service) {
    const codeNavigation = createHostCodeNavigationPort({
      workspaceRoot: options.workspaceRoot,
    });
    return {
      codeNavigation,
      capability: codeNavigation.capability?.() ?? {
        status: 'degraded',
        provider: 'repo_graph',
        reason: 'language_server_not_configured',
        operations: CODE_NAVIGATION_OPERATIONS,
      },
      dispose() {},
    };
  }

  return {
    codeNavigation: createHostCodeNavigationPort({
      workspaceRoot: options.workspaceRoot,
      languageServer: service,
    }),
    diagnostics: service,
    capability: service.capability(),
    dispose: () => service.dispose(),
  };
}

function tryCreateTypeScriptLanguageService(
  workspaceRoot: string,
): TypeScriptLanguageService | undefined {
  try {
    const configPath = ts.findConfigFile(
      workspaceRoot,
      ts.sys.fileExists,
      'tsconfig.json',
    );
    if (!configPath) return undefined;
    // ts.findConfigFile walks parent directories. Benchmark fixtures without a
    // local tsconfig (react-vite) previously attached Mitii's monorepo
    // tsconfig, so every apply_patch diagnostics call threw
    // "Could not find source file" and aborted the write.
    if (!isPathInsideRoot(workspaceRoot, configPath)) {
      return undefined;
    }
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) return undefined;
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      resolve(configPath, '..'),
    );
    return new TypeScriptLanguageService(workspaceRoot, parsed);
  } catch {
    return undefined;
  }
}

/** True when `candidate` is the root itself or a path under it. */
function isPathInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalized = resolve(candidate);
  if (normalized === normalizedRoot) return true;
  const prefix = normalizedRoot.endsWith(sep)
    ? normalizedRoot
    : `${normalizedRoot}${sep}`;
  return normalized.startsWith(prefix);
}

class TypeScriptLanguageService implements CodeNavigationPort, DiagnosticsPort {
  public readonly id = 'typescript-language-service';
  public readonly provider = 'language_server' as const;
  private readonly service: ts.LanguageService;
  /** Files opened after create/write so they join the language-service program. */
  private readonly openFiles = new Set<string>();

  constructor(
    private readonly workspaceRoot: string,
    parsed: ts.ParsedCommandLine,
  ) {
    const root = workspaceRoot;
    const openFiles = this.openFiles;
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => parsed.options,
      getScriptFileNames: () => [
        ...new Set([...parsed.fileNames, ...openFiles]),
      ],
      getScriptVersion: (fileName) => scriptVersion(fileName),
      getScriptSnapshot: (fileName) => {
        const text = ts.sys.readFile(fileName);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => root,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
    this.service = ts.createLanguageService(host);
  }

  public capability(): CodeNavigationCapability {
    return {
      status: 'available',
      provider: 'language_server',
      reason: 'typescript_language_service',
      operations: CODE_NAVIGATION_OPERATIONS,
    };
  }

  public dispose(): void {
    this.service.dispose();
  }

  public async definition(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.definitions(input, (file, position) =>
      this.service.getDefinitionAtPosition(file, position),
    );
  }

  public async references(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const file = this.absolute(input.relativePath);
    const position = this.position(file, input.line, input.column);
    if (position === undefined) return [];
    const entries = this.service.getReferencesAtPosition(file, position) ?? [];
    const locations: CodeNavigationLocation[] = [];
    for (const entry of entries.slice(0, MAX_LOCATIONS)) {
      const location = this.spanLocation(entry.fileName, entry.textSpan, entry.textSpan);
      if (location) locations.push(location);
    }
    return locations;
  }

  public async hover(
    input: CodeNavigationQuery,
  ): Promise<CodeNavigationHover | undefined> {
    const file = this.absolute(input.relativePath);
    const position = this.position(file, input.line, input.column);
    if (position === undefined) return undefined;
    const info = this.service.getQuickInfoAtPosition(file, position);
    if (!info) return undefined;
    const contents = ts.displayPartsToString(info.displayParts).trim();
    return contents ? { contents, language: 'typescript' } : undefined;
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const file = this.absolute(input.relativePath);
    const source = this.service.getProgram()?.getSourceFile(file);
    const tree = this.service.getNavigationTree(file);
    const locations: CodeNavigationLocation[] = [];
    const walk = (node: ts.NavigationTree) => {
      const span = node.nameSpan;
      const named = node as ts.NavigationTree & { name?: string };
      const name =
        named.name ||
        (source && span
          ? source.text.slice(span.start, span.start + span.length)
          : '');
      if (name && span && name !== "<global>" && !name.startsWith('"')) {
        const location = this.spanLocation(file, span, node.spans[0] ?? span);
        if (location) {
          locations.push({
            ...location,
            symbolName: name,
            symbolKind: String(node.kind),
          });
        }
      }
      for (const child of node.childItems ?? []) walk(child);
    };
    walk(tree);
    return locations.slice(0, MAX_LOCATIONS);
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const items = this.service.getNavigateToItems(input.query, MAX_LOCATIONS);
    const locations: CodeNavigationLocation[] = [];
    for (const item of items) {
      const location = this.spanLocation(item.fileName, item.textSpan, item.textSpan);
      if (!location) continue;
      locations.push({
        ...location,
        symbolName: item.name,
        symbolKind: String(item.kind),
      });
    }
    return locations;
  }

  public async implementation(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.definitions(input, (file, position) =>
      this.service.getImplementationAtPosition(file, position),
    );
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const file = this.absolute(input.relativePath);
    const position = this.position(file, input.line, input.column);
    if (position === undefined) return [];
    const prepared = this.service.prepareCallHierarchy(file, position);
    const root = Array.isArray(prepared) ? prepared[0] : prepared;
    if (!root) return [];
    const calls =
      (input.direction ?? 'outgoing') === 'incoming'
        ? this.service
            .provideCallHierarchyIncomingCalls(root.file, root.selectionSpan.start)
            .map((call) => call.from)
        : this.service
            .provideCallHierarchyOutgoingCalls(root.file, root.selectionSpan.start)
            .map((call) => call.to);
    const locations: CodeNavigationLocation[] = [];
    for (const item of calls.slice(0, MAX_LOCATIONS)) {
      const location = this.spanLocation(item.file, item.selectionSpan, item.span);
      if (!location) continue;
      locations.push({
        ...location,
        symbolName: item.name,
        symbolKind: String(item.kind),
      });
    }
    return locations;
  }

  public async readDiagnostics(params: {
    workspaceRoot: string;
    paths?: readonly string[];
  }): Promise<DiagnosticItem[]> {
    const files = params.paths?.length
      ? params.paths.map((path) => this.absolute(path))
      : this.service.getProgram()?.getRootFileNames() ?? [];
    const items: DiagnosticItem[] = [];
    for (const file of files) {
      // apply_patch create (oldText="") asks for a baseline before the file
      // exists. TypeScript throws "Could not find source file" for paths not
      // in the program — that must never abort the mutation (benchmark
      // fe-feature-001/003/007).
      if (!ts.sys.fileExists(file)) {
        continue;
      }
      this.openFiles.add(file);
      let diagnostics: readonly ts.Diagnostic[] = [];
      try {
        if (!this.service.getProgram()?.getSourceFile(file)) {
          // Force a refresh so newly written files enter the program.
          this.service.getProgram();
        }
        diagnostics = [
          ...this.service.getSyntacticDiagnostics(file),
          ...this.service.getSemanticDiagnostics(file),
        ];
      } catch {
        continue;
      }
      for (const diagnostic of diagnostics) {
        const item = this.toDiagnostic(diagnostic);
        if (item) items.push(item);
      }
    }
    return items;
  }

  private definitions(
    input: CodeNavigationQuery,
    read: (
      file: string,
      position: number,
    ) =>
      | readonly {
          fileName: string;
          textSpan: ts.TextSpan;
          name?: string;
          kind?: string;
        }[]
      | undefined,
  ): readonly CodeNavigationLocation[] {
    const file = this.absolute(input.relativePath);
    const position = this.position(file, input.line, input.column);
    if (position === undefined) return [];
    const locations: CodeNavigationLocation[] = [];
    for (const info of (read(file, position) ?? []).slice(0, MAX_LOCATIONS)) {
      const location = this.spanLocation(info.fileName, info.textSpan, info.textSpan);
      if (!location) continue;
      locations.push({
        ...location,
        ...(info.name ? { symbolName: info.name } : {}),
        ...(info.kind ? { symbolKind: String(info.kind) } : {}),
      });
    }
    return locations;
  }

  private absolute(relativePath: string): string {
    return resolve(this.workspaceRoot, relativePath);
  }

  private position(file: string, line: number, column = 1): number | undefined {
    const source = this.service.getProgram()?.getSourceFile(file);
    if (!source) return undefined;
    const zeroLine = Math.max(0, line - 1);
    if (zeroLine >= source.getLineStarts().length) return undefined;
    return source.getPositionOfLineAndCharacter(
      zeroLine,
      Math.max(0, column - 1),
    );
  }

  private spanLocation(
    fileName: string,
    span: ts.TextSpan,
    range: ts.TextSpan | undefined,
  ): CodeNavigationLocation | undefined {
    const source = this.service.getProgram()?.getSourceFile(fileName);
    const relativePath = toRelative(this.workspaceRoot, fileName);
    if (!source || !relativePath) return undefined;
    const start = source.getLineAndCharacterOfPosition(span.start);
    const endSpan = range ?? span;
    const end = source.getLineAndCharacterOfPosition(endSpan.start + endSpan.length);
    return {
      relativePath,
      startLine: start.line + 1,
      startColumn: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
    };
  }

  private toDiagnostic(diagnostic: ts.Diagnostic): DiagnosticItem | undefined {
    if (!diagnostic.file || diagnostic.start === undefined) return undefined;
    const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const end = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start + (diagnostic.length ?? 0),
    );
    const path = toRelative(this.workspaceRoot, diagnostic.file.fileName);
    if (!path) return undefined;
    return {
      path,
      severity:
        diagnostic.category === ts.DiagnosticCategory.Error
          ? 'error'
          : diagnostic.category === ts.DiagnosticCategory.Warning
            ? 'warning'
            : diagnostic.category === ts.DiagnosticCategory.Suggestion
              ? 'hint'
              : 'info',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      startLine: start.line + 1,
      startColumn: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      source: 'typescript',
      code: `TS${diagnostic.code}`,
    };
  }
}

function scriptVersion(fileName: string): string {
  try {
    return String(statSync(fileName).mtimeMs);
  } catch {
    return '0';
  }
}

function toRelative(workspaceRoot: string, fileName: string): string | undefined {
  const value = relative(workspaceRoot, fileName).replace(/\\/g, '/');
  if (!value || value.startsWith('../') || value === '..') return undefined;
  return value;
}
