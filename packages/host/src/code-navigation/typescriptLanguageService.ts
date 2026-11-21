import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';

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

import {
  getIdentifiersOnLine,
  locationKey,
  scriptVersion,
  spanKey,
  throwIfAborted,
  toRelative,
} from './typescriptLanguageServiceSupport.js';

const MAX_LOCATIONS = 40;

type CodeNavigationCallOptions = { signal?: AbortSignal };

type TsApi = typeof bundledTs;

export function tryCreateTypeScriptLanguageService(
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

export class TypeScriptLanguageService implements CodeNavigationPort, DiagnosticsPort {
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

  public async prepare(
    relativePath: string,
    options?: CodeNavigationCallOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal);
    const file = this.absolute(relativePath);
    if (this.ts.sys.fileExists(file)) {
      this.openFiles.add(file);
      // Force program refresh so newly touched files join navigation.
      this.service.getProgram();
    }
  }

  public async definition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(
      () =>
        Promise.resolve(
          this.definitions(input, (file, position) => {
            const bound = this.service.getDefinitionAndBoundSpanAtPosition?.(
              file,
              position,
            );
            return bound?.definitions ?? this.service.getDefinitionAtPosition(file, position);
          }),
        ),
      options?.signal,
    );
  }

  public async typeDefinition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(
      () =>
        Promise.resolve(
          this.definitions(input, (file, position) =>
            this.service.getTypeDefinitionAtPosition(file, position),
          ),
        ),
      options?.signal,
    );
  }

  public async references(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(
      () => Promise.resolve(this.collectReferences(input)),
      options?.signal,
    );
  }

  public async hover(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<CodeNavigationHover | undefined> {
    return this.limit(
      () => Promise.resolve(this.collectHover(input)),
      options?.signal,
    );
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(
      () => Promise.resolve(this.collectDocumentSymbols(input)),
      options?.signal,
    );
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(
      () => Promise.resolve(this.collectWorkspaceSymbols(input)),
      options?.signal,
    );
  }

  public async implementation(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(
      () =>
        Promise.resolve(
          this.definitions(input, (file, position) =>
            this.service.getImplementationAtPosition(file, position),
          ),
        ),
      options?.signal,
    );
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.limit(
      () => Promise.resolve(this.collectCallHierarchy(input)),
      options?.signal,
    );
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
    const includeDeclaration = input.includeDeclaration !== false;
    const declarationKeys = new Set<string>();
    if (!includeDeclaration) {
      for (const position of positions) {
        for (const def of this.service.getDefinitionAtPosition(file, position) ?? []) {
          declarationKeys.add(spanKey(def.fileName, def.textSpan));
        }
      }
    }
    const locations: CodeNavigationLocation[] = [];
    const seen = new Set<string>();
    for (const position of positions) {
      const entries = this.service.getReferencesAtPosition(file, position) ?? [];
      for (const entry of entries) {
        if (
          !includeDeclaration &&
          (entry.isDefinition ||
            declarationKeys.has(spanKey(entry.fileName, entry.textSpan)))
        ) {
          continue;
        }
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
      const signature = this.ts.displayPartsToString(info.displayParts).trim();
      const documentation = this.ts
        .displayPartsToString(info.documentation)
        .trim();
      const tags = (info.tags ?? [])
        .map((tag) => {
          const body = this.ts.displayPartsToString(tag.text).trim();
          return body ? `@${tag.name} ${body}` : `@${tag.name}`;
        })
        .filter(Boolean);
      const parts = [signature, documentation, ...tags].filter(Boolean);
      const contents = parts.join('\n\n').trim();
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
        const rangeSpan =
          'contextSpan' in info && info.contextSpan
            ? (info.contextSpan as bundledTs.TextSpan)
            : info.textSpan;
        const location = this.spanLocation(info.fileName, info.textSpan, rangeSpan);
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
   * resolve every identifier on the line. Explicit column > 1 keeps a single caret.
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

