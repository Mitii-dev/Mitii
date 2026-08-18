export type SourceLanguageId = string;

export type SourceImportKind =
  | "static"
  | "dynamic"
  | "require"
  | "reexport"
  | "unknown";

export type SourceReferenceKind =
  | "call"
  | "construct"
  | "type"
  | "read"
  | "write"
  | "unknown";

export interface TreeSitterRuntimeSymbol {
  name: string;
  nodeType: string;
  /**
   * Capture-derived kind when the query uses `@definition.<kind>`
   * or `@name.definition.<kind>`. Parsers SHOULD prefer this over
   * guessing from `nodeType`.
   */
  kind?: string;
  signature?: string;
  parentName?: string;
  exported?: boolean;
  startLine: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
}

export interface TreeSitterRuntimeImport {
  specifier: string;
  kind?: SourceImportKind;
  importedNames?: readonly string[];
  line: number;
  column?: number;
}

export interface TreeSitterRuntimeReference {
  symbolName: string;
  kind?: SourceReferenceKind;
  line: number;
  column?: number;
}

export interface TreeSitterRuntimeParseInput {
  language: SourceLanguageId;
  relativePath: string;
  content: string;
  /**
   * Tree-sitter query capturing definitions. Accepted capture names:
   * - Mitii: `@name` plus optional `@definition`
   * - Aider tags: `@name.definition.<kind>` plus optional `@definition.<kind>`
   */
  symbolQuery?: string;
  /**
   * Tree-sitter query capturing references. Accepted capture names:
   * - Mitii: `@reference.<kind>` (`call` | `construct` | `type` | `read` | `write`)
   * - Aider tags: `@name.reference.<kind>` plus optional `@reference.<kind>`
   */
  referenceQuery?: string;
  maximumSymbols: number;
  maximumImports: number;
  maximumReferences: number;
  abortSignal?: AbortSignal;
}

export interface TreeSitterRuntimeParseResult {
  symbols: readonly TreeSitterRuntimeSymbol[];
  imports?: readonly TreeSitterRuntimeImport[];
  references?: readonly TreeSitterRuntimeReference[];
  warnings?: readonly string[];
}

export interface TreeSitterRuntimePort {
  readonly id: string;

  supports(language: SourceLanguageId): boolean;

  parse(
    input: TreeSitterRuntimeParseInput,
  ): Promise<TreeSitterRuntimeParseResult>;
}
