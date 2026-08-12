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
  symbolQuery?: string;
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
