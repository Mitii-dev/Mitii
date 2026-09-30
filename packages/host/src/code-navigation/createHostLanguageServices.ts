import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve, sep } from 'node:path';

import bundledTs from 'typescript';
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
  DiagnosticsSettleOptions,
} from '@mitii/v8';
import { CODE_NAVIGATION_OPERATIONS, CODE_NAVIGATION_POLICY, createRequestLimiter } from '@mitii/v8';
import type { RequestLimiter } from '@mitii/v8';

import { createHostCodeNavigationPort } from './createHostCodeNavigationPort.js';
import {
  createStdioLspCodeNavigationPort,
  type StdioLspServerConfig,
} from './createStdioLspCodeNavigationPort.js';

const MAX_LOCATIONS = 40;

type TsApi = typeof bundledTs;

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
  /**
   * Optional stdio language servers for non-TS (or when in-process TS is
   * unavailable). Servers start lazily on first prepare/navigate for a
   * matching extension. Prefer in-process TypeScript when tsconfig exists.
   */
  lspServers?: readonly StdioLspServerConfig[];
  abortSignal?: AbortSignal;
}): HostLanguageServices {
  const service = tryCreateTypeScriptLanguageService(options.workspaceRoot);
  const stdio =
    options.lspServers && options.lspServers.length > 0
      ? createStdioLspCodeNavigationPort({
          workspaceRoot: options.workspaceRoot,
          servers: options.lspServers,
          abortSignal: options.abortSignal,
        })
      : undefined;

  if (service) {
    // Prefer in-process TS; keep stdio as outer fallback for other languages
    // via a small composite that routes by whether TS can see the file.
    const languageServer: CodeNavigationPort = stdio
      ? new PreferTypeScriptThenStdioPort(service, stdio)
      : service;
    return {
      codeNavigation: createHostCodeNavigationPort({
        workspaceRoot: options.workspaceRoot,
        languageServer,
      }),
      diagnostics: service,
      capability: service.capability(),
      dispose() {
        service.dispose();
        void stdio?.dispose();
      },
    };
  }

  if (stdio) {
    return {
      codeNavigation: createHostCodeNavigationPort({
        workspaceRoot: options.workspaceRoot,
        languageServer: stdio,
      }),
      capability: {
        status: 'available',
        provider: 'language_server',
        reason: 'stdio_lsp_configured',
        operations: CODE_NAVIGATION_OPERATIONS,
      },
      dispose() {
        void stdio.dispose();
      },
    };
  }

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

/**
 * Routes TS/JS through the in-process service; other extensions through stdio.
 * Empty TS results still fall through to stdio then graph via Fallback.
 */
class PreferTypeScriptThenStdioPort implements CodeNavigationPort {
  public readonly id = 'typescript-then-stdio';
  public readonly provider = 'language_server' as const;

  constructor(
    private readonly typescript: CodeNavigationPort,
    private readonly stdio: CodeNavigationPort,
  ) {}

  public capability(): CodeNavigationCapability {
    return (
      this.typescript.capability?.() ?? {
        status: 'available',
        provider: 'language_server',
        reason: 'typescript_language_service',
        operations: CODE_NAVIGATION_OPERATIONS,
      }
    );
  }

  public async prepare(relativePath: string): Promise<void> {
    if (isTypeScriptPath(relativePath)) {
      await this.typescript.prepare?.(relativePath);
      return;
    }
    await this.stdio.prepare?.(relativePath);
  }

  public async definition(input: CodeNavigationQuery) {
    if (isTypeScriptPath(input.relativePath)) {
      const locations = await this.typescript.definition(input);
      if (locations.length > 0) return locations;
    }
    return this.stdio.definition(input);
  }

  public async typeDefinition(input: CodeNavigationQuery) {
    if (isTypeScriptPath(input.relativePath)) {
      const locations = await this.typescript.typeDefinition?.(input);
      if (locations && locations.length > 0) return locations;
    }
    return this.stdio.typeDefinition?.(input) ?? [];
  }

  public async references(input: CodeNavigationQuery) {
    if (isTypeScriptPath(input.relativePath)) {
      const locations = await this.typescript.references(input);
      if (locations.length > 0) return locations;
    }
    return this.stdio.references(input);
  }

  public async hover(input: CodeNavigationQuery) {
    if (isTypeScriptPath(input.relativePath)) {
      const hover = await this.typescript.hover?.(input);
      if (hover) return hover;
    }
    return this.stdio.hover?.(input);
  }

  public async documentSymbols(input: CodeNavigationDocumentQuery) {
    if (isTypeScriptPath(input.relativePath)) {
      const locations = await this.typescript.documentSymbols?.(input);
      if (locations && locations.length > 0) return locations;
    }
    return this.stdio.documentSymbols?.(input) ?? [];
  }

  public async workspaceSymbols(input: CodeNavigationWorkspaceQuery) {
    const primary = await this.typescript.workspaceSymbols?.(input);
    if (primary && primary.length > 0) return primary;
    return this.stdio.workspaceSymbols?.(input) ?? [];
  }

  public async implementation(input: CodeNavigationQuery) {
    if (isTypeScriptPath(input.relativePath)) {
      const locations = await this.typescript.implementation?.(input);
      if (locations && locations.length > 0) return locations;
    }
    return this.stdio.implementation?.(input) ?? [];
  }

  public async callHierarchy(input: CodeNavigationQuery) {
    if (isTypeScriptPath(input.relativePath)) {
      const locations = await this.typescript.callHierarchy?.(input);
      if (locations && locations.length > 0) return locations;
    }
    return this.stdio.callHierarchy?.(input) ?? [];
  }
}

function isTypeScriptPath(relativePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(relativePath);
}

function tryCreateTypeScriptLanguageService(
  workspaceRoot: string,
): TypeScriptLanguageService | undefined {
  try {
    const ts = loadProjectTypeScript(workspaceRoot);
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
    return new TypeScriptLanguageService(workspaceRoot, parsed, ts);
  } catch {
    return undefined;
  }
}

/**
 * Prefer the workspace's own typescript package so navigation matches the
 * project's compiler. Fall back to Mitii's bundled typescript.
 */
function loadProjectTypeScript(workspaceRoot: string): TsApi {
  try {
    const packageJson = resolve(workspaceRoot, 'package.json');
    if (!existsSync(packageJson)) return bundledTs;
    const req = createRequire(packageJson);
    return req('typescript') as TsApi;
  } catch {
    return bundledTs;
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
  private readonly service: bundledTs.LanguageService;
  private readonly ts: TsApi;
  private readonly limit: RequestLimiter;
  /** Files opened after create/write so they join the language-service program. */
  private readonly openFiles = new Set<string>();

  constructor(
    private readonly workspaceRoot: string,
    parsed: bundledTs.ParsedCommandLine,
    ts: TsApi,
  ) {
    this.ts = ts;
    this.limit = createRequestLimiter({
      limit: CODE_NAVIGATION_POLICY.requestLimit,
      timeoutMs: CODE_NAVIGATION_POLICY.requestTimeoutMs,
    });
    const root = workspaceRoot;
    const openFiles = this.openFiles;
    const host: bundledTs.LanguageServiceHost = {
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
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
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

  public async prepare(relativePath: string): Promise<void> {
    const file = this.absolute(relativePath);
    if (this.ts.sys.fileExists(file)) {
      this.openFiles.add(file);
      // Force program refresh so newly touched files join navigation.
      this.service.getProgram();
    }
  }

  public async definition(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(() =>
      Promise.resolve(
        this.definitions(input, (file, position) =>
          this.service.getDefinitionAtPosition(file, position),
        ),
      ),
    );
  }

  public async typeDefinition(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(() =>
      Promise.resolve(
        this.definitions(input, (file, position) =>
          this.service.getTypeDefinitionAtPosition(file, position),
        ),
      ),
    );
  }

  public async references(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(() =>
      Promise.resolve(this.collectReferences(input)),
    );
  }

  public async hover(
    input: CodeNavigationQuery,
  ): Promise<CodeNavigationHover | undefined> {
    return this.limit(() => Promise.resolve(this.collectHover(input)));
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(() => Promise.resolve(this.collectDocumentSymbols(input)));
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(() => Promise.resolve(this.collectWorkspaceSymbols(input)));
  }

  public async implementation(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(() =>
      Promise.resolve(
        this.definitions(input, (file, position) =>
          this.service.getImplementationAtPosition(file, position),
        ),
      ),
    );
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(() => Promise.resolve(this.collectCallHierarchy(input)));
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
      if (!this.ts.sys.fileExists(file)) {
        continue;
      }
      this.openFiles.add(file);
      let diagnostics: readonly bundledTs.Diagnostic[] = [];
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

  /**
   * TypeScript language service diagnostics are synchronous once files are
   * in the program — settle is a no-op after ensuring changed paths are open.
   */
  public async settleDiagnostics(
    options: DiagnosticsSettleOptions,
  ): Promise<void> {
    for (const relativePath of options.paths ?? []) {
      const absolute = this.absolute(relativePath);
      if (absolute) {
        this.openFiles.add(absolute);
      }
    }
  }

  private collectReferences(
    input: CodeNavigationQuery,
  ): readonly CodeNavigationLocation[] {
    const file = this.absolute(input.relativePath);
    const positions = this.resolvePositions(file, input);
    if (positions.length === 0) return [];
    const locations: CodeNavigationLocation[] = [];
    const seen = new Set<string>();
    for (const position of positions) {
      const entries = this.service.getReferencesAtPosition(file, position) ?? [];
      for (const entry of entries) {
        const location = this.spanLocation(entry.fileName, entry.textSpan, entry.textSpan);
        if (!location) continue;
        const key = locationKey(location);
        if (seen.has(key)) continue;
        seen.add(key);
        locations.push(location);
        if (locations.length >= MAX_LOCATIONS) return locations;
      }
    }
    return locations;
  }

  private collectHover(
    input: CodeNavigationQuery,
  ): CodeNavigationHover | undefined {
    const file = this.absolute(input.relativePath);
    const positions = this.resolvePositions(file, input);
    for (const position of positions) {
      const info = this.service.getQuickInfoAtPosition(file, position);
      if (!info) continue;
      const contents = this.ts.displayPartsToString(info.displayParts).trim();
      if (contents) return { contents, language: 'typescript' };
    }
    return undefined;
  }

  private collectDocumentSymbols(
    input: CodeNavigationDocumentQuery,
  ): readonly CodeNavigationLocation[] {
    const file = this.absolute(input.relativePath);
    const source = this.service.getProgram()?.getSourceFile(file);
    const tree = this.service.getNavigationTree(file);
    const locations: CodeNavigationLocation[] = [];
    const walk = (node: bundledTs.NavigationTree) => {
      const span = node.nameSpan;
      const named = node as bundledTs.NavigationTree & { name?: string };
      const name =
        named.name ||
        (source && span
          ? source.text.slice(span.start, span.start + span.length)
          : '');
      if (name && span && name !== '<global>' && !name.startsWith('"')) {
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

  private collectWorkspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
  ): readonly CodeNavigationLocation[] {
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

  private collectCallHierarchy(
    input: CodeNavigationQuery,
  ): readonly CodeNavigationLocation[] {
    const file = this.absolute(input.relativePath);
    const positions = this.resolvePositions(file, input);
    if (positions.length === 0) return [];
    const locations: CodeNavigationLocation[] = [];
    const seen = new Set<string>();
    for (const position of positions) {
      const prepared = this.service.prepareCallHierarchy(file, position);
      const root = Array.isArray(prepared) ? prepared[0] : prepared;
      if (!root) continue;
      const calls =
        (input.direction ?? 'outgoing') === 'incoming'
          ? this.service
              .provideCallHierarchyIncomingCalls(root.file, root.selectionSpan.start)
              .map((call) => call.from)
          : this.service
              .provideCallHierarchyOutgoingCalls(root.file, root.selectionSpan.start)
              .map((call) => call.to);
      for (const item of calls) {
        const location = this.spanLocation(item.file, item.selectionSpan, item.span);
        if (!location) continue;
        const keyed = {
          ...location,
          symbolName: item.name,
          symbolKind: String(item.kind),
        };
        const key = locationKey(keyed);
        if (seen.has(key)) continue;
        seen.add(key);
        locations.push(keyed);
        if (locations.length >= MAX_LOCATIONS) return locations;
      }
    }
    return locations;
  }

  private definitions(
    input: CodeNavigationQuery,
    read: (
      file: string,
      position: number,
    ) =>
      | readonly {
          fileName: string;
          textSpan: bundledTs.TextSpan;
          name?: string;
          kind?: string;
        }[]
      | undefined,
  ): readonly CodeNavigationLocation[] {
    const file = this.absolute(input.relativePath);
    const positions = this.resolvePositions(file, input);
    if (positions.length === 0) return [];
    const locations: CodeNavigationLocation[] = [];
    const seen = new Set<string>();
    for (const position of positions) {
      for (const info of read(file, position) ?? []) {
        const location = this.spanLocation(info.fileName, info.textSpan, info.textSpan);
        if (!location) continue;
        const keyed = {
          ...location,
          ...(info.name ? { symbolName: info.name } : {}),
          ...(info.kind ? { symbolKind: String(info.kind) } : {}),
        };
        const key = locationKey(keyed);
        if (seen.has(key)) continue;
        seen.add(key);
        locations.push(keyed);
        if (locations.length >= MAX_LOCATIONS) return locations;
      }
    }
    return locations;
  }

  /**
   * When column is omitted/default (1), agents usually mean "this line" —
   * resolve every identifier on the line (Cline typescript-lsp pattern).
   * Explicit column > 1 keeps a single caret.
   */
  private resolvePositions(file: string, input: CodeNavigationQuery): number[] {
    const column = input.column ?? 1;
    if (column > 1) {
      const position = this.position(file, input.line, column);
      return position === undefined ? [] : [position];
    }
    const source = this.service.getProgram()?.getSourceFile(file);
    if (!source) return [];
    const identifiers = getIdentifiersOnLine(this.ts, source, input.line);
    if (identifiers.length === 0) {
      const position = this.position(file, input.line, column);
      return position === undefined ? [] : [position];
    }
    const seenNames = new Set<string>();
    const offsets: number[] = [];
    for (const identifier of identifiers) {
      if (seenNames.has(identifier.name)) continue;
      seenNames.add(identifier.name);
      offsets.push(identifier.offset);
    }
    return offsets;
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
    span: bundledTs.TextSpan,
    range: bundledTs.TextSpan | undefined,
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

  private toDiagnostic(diagnostic: bundledTs.Diagnostic): DiagnosticItem | undefined {
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
        diagnostic.category === this.ts.DiagnosticCategory.Error
          ? 'error'
          : diagnostic.category === this.ts.DiagnosticCategory.Warning
            ? 'warning'
            : diagnostic.category === this.ts.DiagnosticCategory.Suggestion
              ? 'hint'
              : 'info',
      message: this.ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      startLine: start.line + 1,
      startColumn: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      source: 'typescript',
      code: `TS${diagnostic.code}`,
    };
  }
}

function getIdentifiersOnLine(
  ts: TsApi,
  sourceFile: bundledTs.SourceFile,
  targetLine: number,
): Array<{ offset: number; name: string }> {
  const identifiers: Array<{ offset: number; name: string }> = [];
  const visit = (node: bundledTs.Node) => {
    if (ts.isIdentifier(node)) {
      const lc = ts.getLineAndCharacterOfPosition(
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
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return identifiers;
}

function locationKey(location: CodeNavigationLocation): string {
  return [
    location.relativePath,
    String(location.startLine),
    String(location.startColumn ?? ''),
    location.symbolName ?? '',
  ].join('\0');
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
