/**
 * Native node-tree-sitter runtime (optional). Falls through per-language when
 * a grammar package is missing; hosts pair this with WASM via createDefault.
 */

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

const NATIVE_GRAMMAR_PACKAGES: Record<string, string> = {
  typescript: 'tree-sitter-typescript/typescript',
  tsx: 'tree-sitter-typescript/tsx',
  javascript: 'tree-sitter-javascript',
  jsx: 'tree-sitter-javascript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
};

type NativeParser = {
  setLanguage: (language: unknown) => void;
  parse: (content: string) => { rootNode: NativeNode };
};

type NativeNode = {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text: string;
  isMissing: boolean;
  hasError: boolean;
  children: NativeNode[];
};

type NativeQuery = {
  captures: (
    node: NativeNode,
  ) => Array<{ name: string; node: NativeNode }>;
};

type TreeSitterModule = {
  Parser: new () => NativeParser;
  Language: { load?: (path: string) => Promise<unknown> };
  Query: new (language: unknown, source: string) => NativeQuery;
};

export class NativeTreeSitterRuntime implements TreeSitterRuntimePort {
  public readonly id = 'native-tree-sitter';

  private parserModule?: TreeSitterModule;
  private languages = new Map<string, unknown>();
  private unavailable = false;

  public supports(language: string): boolean {
    if (this.unavailable) return false;
    return Object.prototype.hasOwnProperty.call(
      NATIVE_GRAMMAR_PACKAGES,
      language,
    );
  }

  public async parse(
    input: TreeSitterRuntimeParseInput,
  ): Promise<TreeSitterRuntimeParseResult> {
    if (input.abortSignal?.aborted) {
      throw new Error('tree-sitter parse aborted');
    }
    const mod = await this.loadModule();
    if (!mod) {
      return { symbols: [], warnings: ['native tree-sitter unavailable'] };
    }

    const language = await this.loadLanguage(mod, input.language);
    if (!language) {
      return {
        symbols: [],
        warnings: [`native grammar missing for ${input.language}`],
      };
    }

    const parser = new mod.Parser();
    parser.setLanguage(language);
    const tree = parser.parse(input.content);
    const symbols: TreeSitterRuntimeSymbol[] = [];
    const references: TreeSitterRuntimeReference[] = [];

    if (input.symbolQuery) {
      try {
        const query = new mod.Query(language, input.symbolQuery);
        const captures = query.captures(tree.rootNode);
        for (const capture of captures) {
          if (symbols.length >= input.maximumSymbols) break;
          if (!isSymbolNameCapture(capture.name) && !isSymbolDefinitionCapture(capture.name)) {
            continue;
          }
          if (!isSymbolNameCapture(capture.name)) continue;
          const kind = symbolKindFromCapture(capture.name);
          symbols.push({
            name: capture.node.text,
            nodeType: capture.node.type,
            ...(kind ? { kind } : {}),
            startLine: capture.node.startPosition.row + 1,
            endLine: capture.node.endPosition.row + 1,
            startColumn: capture.node.startPosition.column,
            endColumn: capture.node.endPosition.column,
          });
        }
      } catch {
        /* query may not compile for this grammar version */
      }
    }

    if (input.referenceQuery) {
      try {
        const query = new mod.Query(language, input.referenceQuery);
        const captures = query.captures(tree.rootNode);
        for (const capture of captures) {
          if (references.length >= input.maximumReferences) break;
          if (!isReferenceNameCapture(capture.name)) continue;
          const kind = referenceKindFromCapture(capture.name);
          references.push({
            symbolName: capture.node.text,
            ...(kind ? { kind } : {}),
            line: capture.node.startPosition.row + 1,
            column: capture.node.startPosition.column,
          });
        }
      } catch {
        /* ignore */
      }
    }

    return {
      symbols,
      ...(references.length > 0 ? { references } : {}),
    };
  }

  private async loadModule(): Promise<TreeSitterModule | undefined> {
    if (this.unavailable) return undefined;
    if (this.parserModule) return this.parserModule;
    try {
      const mod = (await import('tree-sitter')) as unknown as TreeSitterModule & {
        default?: TreeSitterModule;
      };
      this.parserModule = (mod.default ?? mod) as TreeSitterModule;
      return this.parserModule;
    } catch {
      this.unavailable = true;
      return undefined;
    }
  }

  private async loadLanguage(
    _mod: TreeSitterModule,
    language: string,
  ): Promise<unknown | undefined> {
    if (this.languages.has(language)) return this.languages.get(language);
    const pkg = NATIVE_GRAMMAR_PACKAGES[language];
    if (!pkg) return undefined;
    try {
      const grammar = (await import(pkg)) as { default?: unknown } | unknown;
      const languageObj =
        grammar && typeof grammar === 'object' && 'default' in grammar
          ? (grammar as { default: unknown }).default
          : grammar;
      this.languages.set(language, languageObj);
      return languageObj;
    } catch {
      return undefined;
    }
  }
}
