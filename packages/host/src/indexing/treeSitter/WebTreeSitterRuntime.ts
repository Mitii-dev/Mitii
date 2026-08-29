import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { resolveRuntimeFilename } from '../../internal/resolveRuntimeFilename.js';

import type {
  TreeSitterRuntimeParseInput,
  TreeSitterRuntimeParseResult,
  TreeSitterRuntimePort,
  TreeSitterRuntimeReference,
  TreeSitterRuntimeSymbol,
} from '@mitii/v8';

import {
  isReferenceNameCapture,
  isSymbolDefinitionCapture,
  isSymbolNameCapture,
  referenceKindFromCapture,
  symbolKindFromCapture,
} from './treeSitterQueryCaptures.js';

type TreeSitterPoint = {
  row: number;
  column: number;
};

type TreeSitterNode = {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  parent: TreeSitterNode | null;
};

type TreeSitterQueryCapture = {
  name: string;
  node: TreeSitterNode;
};

type TreeSitterQueryMatch = {
  captures: TreeSitterQueryCapture[];
};

type TreeSitterQuery = {
  matches(
    node: TreeSitterNode,
    options?: { matchLimit?: number },
  ): TreeSitterQueryMatch[];
  didExceedMatchLimit?: () => boolean;
  delete?: () => void;
};

type TreeSitterLanguage = {
  query?: (source: string) => TreeSitterQuery;
};

type TreeSitterTree = {
  rootNode: TreeSitterNode;
  delete?: () => void;
};

type TreeSitterParser = {
  setLanguage(language: TreeSitterLanguage): void;
  parse(content: string): TreeSitterTree | null;
  delete?: () => void;
};

type TreeSitterParserConstructor = {
  new (): TreeSitterParser;
  init(moduleOptions?: {
    locateFile?: (
      scriptName: string,
      scriptDirectory: string,
    ) => string;
  }): Promise<void>;
  Language?: {
    load(input: string | Uint8Array): Promise<TreeSitterLanguage>;
  };
};

type TreeSitterQueryConstructor = {
  new (
    language: TreeSitterLanguage,
    source: string,
  ): TreeSitterQuery;
};

type WebTreeSitterModule = {
  default?: TreeSitterParserConstructor;
  Parser?: TreeSitterParserConstructor;
  Language?: {
    load(input: string | Uint8Array): Promise<TreeSitterLanguage>;
  };
  Query?: TreeSitterQueryConstructor;
};

export const WEB_TREE_SITTER_GRAMMAR_WASM_BY_LANGUAGE = {
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
  dart: 'tree-sitter-dart.wasm',
  elixir: 'tree-sitter-elixir.wasm',
  go: 'tree-sitter-go.wasm',
  haskell: 'tree-sitter-haskell.wasm',
  java: 'tree-sitter-java.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  lua: 'tree-sitter-lua.wasm',
  php: 'tree-sitter-php.wasm',
  python: 'tree-sitter-python.wasm',
  ruby: 'tree-sitter-ruby.wasm',
  rust: 'tree-sitter-rust.wasm',
  scala: 'tree-sitter-scala.wasm',
  shell: 'tree-sitter-bash.wasm',
  solidity: 'tree-sitter-solidity.wasm',
  sql: 'tree-sitter-sql.wasm',
  swift: 'tree-sitter-swift.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  zig: 'tree-sitter-zig.wasm',
} as const;

export interface WebTreeSitterRuntimeOptions {
  coreWasmPath: string;
  grammarWasmPaths: Readonly<Record<string, string>>;
  loadModule?: () => Promise<unknown>;
}

interface RawRuntimeSymbol {
  name: string;
  node: TreeSitterNode;
  nameNode: TreeSitterNode;
  kind?: string;
}

export class WebTreeSitterRuntime implements TreeSitterRuntimePort {
  public readonly id = 'web-tree-sitter';

  private ready?: Promise<void>;
  private module?: Promise<WebTreeSitterModule>;
  private languages = new Map<string, Promise<TreeSitterLanguage>>();

  public constructor(
    private readonly options: WebTreeSitterRuntimeOptions,
  ) {}

  public supports(language: string): boolean {
    return (
      Object.prototype.hasOwnProperty.call(
        this.options.grammarWasmPaths,
        language,
      ) &&
      Boolean(this.options.grammarWasmPaths[language])
    );
  }

  public async parse(
    input: TreeSitterRuntimeParseInput,
  ): Promise<TreeSitterRuntimeParseResult> {
    this.throwIfAborted(input.abortSignal);

    const warnings: string[] = [];
    const module = await this.loadWebTreeSitter();
    await this.ensureInit(module);

    this.throwIfAborted(input.abortSignal);

    const language = await this.loadLanguage(module, input.language);
    const Parser = this.getParser(module);
    const parser = new Parser();
    let tree: TreeSitterTree | null = null;

    try {
      parser.setLanguage(language);
      tree = parser.parse(input.content);

      if (!tree) {
        return {
          symbols: [],
          imports: [],
          references: [],
          warnings: ['parse returned no syntax tree'],
        };
      }

      const symbols = input.symbolQuery
        ? this.extractSymbols({
            language,
            module,
            querySource: input.symbolQuery,
            rootNode: tree.rootNode,
            maximumSymbols: input.maximumSymbols,
            warnings,
            abortSignal: input.abortSignal,
          })
        : [];

      const references = input.referenceQuery
        ? this.extractReferences({
            language,
            module,
            querySource: input.referenceQuery,
            rootNode: tree.rootNode,
            maximumReferences: input.maximumReferences,
            warnings,
            abortSignal: input.abortSignal,
          })
        : [];

      return {
        symbols,
        imports: [],
        references,
        warnings,
      };
    } finally {
      tree?.delete?.();
      parser.delete?.();
    }
  }

  private async ensureInit(
    module: WebTreeSitterModule,
  ): Promise<void> {
    this.ready ??= this.getParser(module).init({
      locateFile: () => this.options.coreWasmPath,
    });

    await this.ready;
  }

  private async loadLanguage(
    module: WebTreeSitterModule,
    language: string,
  ): Promise<TreeSitterLanguage> {
    const existing = this.languages.get(language);

    if (existing) {
      return existing;
    }

    const wasmPath = this.options.grammarWasmPaths[language];

    if (!wasmPath) {
      throw new Error(
        `Tree-sitter grammar is not configured for language "${language}".`,
      );
    }

    const loader =
      module.Language ??
      this.getParser(module).Language;

    if (!loader) {
      throw new Error(
        'web-tree-sitter Language loader is unavailable.',
      );
    }

    const loading = loader.load(wasmPath);
    this.languages.set(language, loading);
    return loading;
  }

  private extractSymbols(options: {
    language: TreeSitterLanguage;
    module: WebTreeSitterModule;
    querySource: string;
    rootNode: TreeSitterNode;
    maximumSymbols: number;
    warnings: string[];
    abortSignal?: AbortSignal;
  }): TreeSitterRuntimeSymbol[] {
    const raw: RawRuntimeSymbol[] = [];
    const seen = new Set<string>();
    const query = this.tryCreateQuery(
      options.module,
      options.language,
      options.querySource,
      options.warnings,
      'symbol',
    );

    if (!query) {
      return [];
    }

    try {
      const matches = query.matches(options.rootNode, {
        matchLimit: options.maximumSymbols * 4,
      });

      for (const match of matches) {
        this.throwIfAborted(options.abortSignal);

        if (raw.length >= options.maximumSymbols) {
          options.warnings.push(
            `symbols truncated at ${options.maximumSymbols}`,
          );
          break;
        }

        const nameCapture = match.captures.find((capture) =>
          isSymbolNameCapture(capture.name),
        );

        if (!nameCapture) {
          continue;
        }

        const definitionCapture =
          match.captures.find((capture) =>
            isSymbolDefinitionCapture(capture.name),
          ) ?? nameCapture;

        const name = nameCapture.node.text.trim();

        if (!name) {
          continue;
        }

        const node = definitionCapture.node;
        const key = [
          node.startIndex,
          node.endIndex,
          name,
          node.type,
        ].join(':');

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        raw.push({
          name,
          node,
          nameNode: nameCapture.node,
          kind:
            symbolKindFromCapture(definitionCapture.name) ??
            symbolKindFromCapture(nameCapture.name),
        });
      }

      if (query.didExceedMatchLimit?.()) {
        options.warnings.push(
          'symbol query exceeded tree-sitter match limit',
        );
      }
    } finally {
      query.delete?.();
    }

    return raw.map((item) => ({
      name: item.name,
      nodeType: item.node.type,
      ...(item.kind ? { kind: item.kind } : {}),
      signature: this.signatureForNode(item.node),
      parentName: this.findParentSymbolName(item, raw),
      exported: this.isExported(item.node),
      startLine: item.nameNode.startPosition.row + 1,
      endLine: item.node.endPosition.row + 1,
      startColumn: item.nameNode.startPosition.column + 1,
      endColumn: item.nameNode.endPosition.column + 1,
    }));
  }

  private extractReferences(options: {
    language: TreeSitterLanguage;
    module: WebTreeSitterModule;
    querySource: string;
    rootNode: TreeSitterNode;
    maximumReferences: number;
    warnings: string[];
    abortSignal?: AbortSignal;
  }): TreeSitterRuntimeReference[] {
    const references: TreeSitterRuntimeReference[] = [];
    const seen = new Set<string>();
    const query = this.tryCreateQuery(
      options.module,
      options.language,
      options.querySource,
      options.warnings,
      'reference',
    );

    if (!query) {
      return [];
    }

    try {
      const matches = query.matches(options.rootNode, {
        matchLimit: options.maximumReferences * 4,
      });

      for (const match of matches) {
        this.throwIfAborted(options.abortSignal);

        const nameCapture = match.captures.find((capture) =>
          capture.name.startsWith('name.reference.'),
        );
        const kindCapture = match.captures.find(
          (capture) =>
            capture.name.startsWith('reference.') ||
            capture.name.startsWith('name.reference.'),
        );
        const capture = nameCapture ?? kindCapture;

        if (!capture || !isReferenceNameCapture(capture.name)) {
          continue;
        }

        if (references.length >= options.maximumReferences) {
          options.warnings.push(
            `references truncated at ${options.maximumReferences}`,
          );
          break;
        }

        const symbolName = capture.node.text.trim();

        if (!symbolName) {
          continue;
        }

        const key = [
          capture.node.startIndex,
          capture.node.endIndex,
          capture.name,
          symbolName,
        ].join(':');

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        references.push({
          symbolName,
          kind: referenceKindFromCapture(
            kindCapture?.name ?? capture.name,
          ),
          line: capture.node.startPosition.row + 1,
          column: capture.node.startPosition.column + 1,
        });
      }

      if (query.didExceedMatchLimit?.()) {
        options.warnings.push(
          'reference query exceeded tree-sitter match limit',
        );
      }
    } finally {
      query.delete?.();
    }

    return references;
  }

  private tryCreateQuery(
    module: WebTreeSitterModule,
    language: TreeSitterLanguage,
    querySource: string,
    warnings: string[],
    queryKind: 'symbol' | 'reference',
  ): TreeSitterQuery | undefined {
    try {
      return this.createQuery(module, language, querySource);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      warnings.push(`${queryKind} query failed to compile: ${message}`);
      return undefined;
    }
  }

  private createQuery(
    module: WebTreeSitterModule,
    language: TreeSitterLanguage,
    querySource: string,
  ): TreeSitterQuery {
    if (language.query) {
      return language.query(querySource);
    }

    if (!module.Query) {
      throw new Error('web-tree-sitter Query constructor is unavailable.');
    }

    return new module.Query(language, querySource);
  }

  private async loadWebTreeSitter(): Promise<WebTreeSitterModule> {
    this.module ??= (this.options.loadModule
      ? this.options.loadModule()
      : import('web-tree-sitter')) as Promise<WebTreeSitterModule>;

    return this.module;
  }

  private getParser(
    module: WebTreeSitterModule,
  ): TreeSitterParserConstructor {
    const Parser = module.default ?? module.Parser;

    if (!Parser) {
      throw new Error('web-tree-sitter Parser constructor is unavailable.');
    }

    return Parser;
  }

  private signatureForNode(node: TreeSitterNode): string {
    return node.text.split(/\r?\n/, 1)[0]?.trim() ?? '';
  }

  private findParentSymbolName(
    item: RawRuntimeSymbol,
    symbols: readonly RawRuntimeSymbol[],
  ): string | undefined {
    let parent: RawRuntimeSymbol | undefined;

    for (const candidate of symbols) {
      if (
        candidate === item ||
        candidate.node.startIndex >= item.node.startIndex ||
        candidate.node.endIndex < item.node.endIndex
      ) {
        continue;
      }

      if (
        !parent ||
        candidate.node.startIndex > parent.node.startIndex
      ) {
        parent = candidate;
      }
    }

    return parent?.name;
  }

  private isExported(node: TreeSitterNode): boolean {
    let current: TreeSitterNode | null = node;

    while (current) {
      const text = current.text.trimStart();

      if (
        text.startsWith('export ') ||
        text.startsWith('export default ') ||
        text.startsWith('pub ')
      ) {
        return true;
      }

      current = current.parent;
    }

    return false;
  }

  private throwIfAborted(abortSignal?: AbortSignal): void {
    if (!abortSignal?.aborted) {
      return;
    }

    const error = new Error('Tree-sitter parse aborted.');
    error.name = 'AbortError';
    throw error;
  }
}

function treeSitterAssetRoots(): string[] {
  const roots: string[] = [];
  const configuredRoot = process.env.MITII_TREE_SITTER_ASSET_ROOT;
  if (configuredRoot) {
    roots.push(configuredRoot);
  }
  const moduleDir = dirname(resolveRuntimeFilename());
  roots.push(join(moduleDir, 'tree-sitter'));
  roots.push(join(moduleDir, '..', 'tree-sitter'));
  roots.push(join(moduleDir, '..', '..', 'tree-sitter'));
  return roots;
}

function resolveWithNodeRequire(candidate: string): string | undefined {
  try {
    return createRequire(resolveRuntimeFilename()).resolve(candidate);
  } catch {
    return undefined;
  }
}

export function resolveTreeSitterPackageAsset(
  candidates: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    const resolved = resolveWithNodeRequire(candidate);
    if (resolved) {
      return resolved;
    }

    const basename = candidate.split('/').pop();
    if (!basename) continue;
    for (const root of treeSitterAssetRoots()) {
      const nested = join(root, candidate);
      const direct = join(root, basename);
      if (existsSync(nested)) return nested;
      if (existsSync(direct)) return direct;
    }
  }

  return undefined;
}
