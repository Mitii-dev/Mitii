import type {
  WorkspaceFileEntry,
} from "../workspace/types";

/**
 * LANGUAGE DETECTION
 */

export type SourceLanguageId = string;

export type SourceLanguageDetectionSource =
  | "explicit"
  | "basename"
  | "extension"
  | "unknown";

export interface SourceLanguageDetection {
  language?: SourceLanguageId;
  source: SourceLanguageDetectionSource;
  evidence: string;
}

export interface SourceLanguageDetectorOptions {
  additionalBasenames?: Readonly<
    Record<string, SourceLanguageId>
  >;

  additionalExtensions?: Readonly<
    Record<string, SourceLanguageId>
  >;
}

/**
 * FILE READING
 */

export interface SourceFileReaderOptions {
  maximumBytes?: number;
}

export interface SourceFileReaderInput {
  sourceId: string;
  file: WorkspaceFileEntry;
}

export interface SourceFileContent {
  sourceId: string;
  rootId: string;
  relativePath: string;
  providerPath: string;
  content: string;
  byteLength: number;
}

export type SourceFileReadErrorCode =
  | "not_a_file"
  | "provider_path_missing"
  | "read_failed";

/**
 * SOURCE FACTS
 */

export type SourceAnalysisQuality =
  | "precise"
  | "structural"
  | "heuristic"
  | "none";

export type SourceAnalysisStatus =
  | "complete"
  | "partial"
  | "unsupported"
  | "failed";

export interface SourceAnalysisSymbol {
  /**
   * Stable only inside this file analysis.
   *
   * Code Index creates the public cross-snapshot symbol ID.
   */
  localId: string;

  name: string;
  kind: string;

  parentLocalId?: string;
  exported?: boolean;
  signature?: string;

  startLine: number;
  endLine?: number;

  startColumn?: number;
  endColumn?: number;
}

export type SourceImportKind =
  | "static"
  | "dynamic"
  | "require"
  | "reexport"
  | "unknown";

export interface SourceAnalysisImport {
  specifier: string;
  kind: SourceImportKind;
  importedNames: string[];
  line: number;
  column?: number;
}

export type SourceReferenceKind =
  | "call"
  | "construct"
  | "type"
  | "read"
  | "write"
  | "unknown";

export interface SourceAnalysisReference {
  symbolName: string;
  kind: SourceReferenceKind;
  line: number;
  column?: number;
}

/**
 * WARNINGS
 */

export type SourceAnalysisWarningCode =
  | "language_unknown"
  | "parser_not_found"
  | "parser_failed"
  | "parser_runtime_warning"
  | "parser_returned_empty"
  | "parser_result_invalid"
  | "syntax_diagnostics"
  | "symbols_truncated"
  | "imports_truncated"
  | "references_truncated"
  | "duplicate_symbol_removed"
  | "duplicate_import_removed"
  | "duplicate_reference_removed"
  | "invalid_parent_removed";

export interface SourceAnalysisWarning {
  code: SourceAnalysisWarningCode;
  message: string;
  parserId?: string;
  line?: number;
}

/**
 * PARSER PORT
 */

export interface SourceParserInput {
  sourceId: string;
  rootId: string;
  relativePath: string;
  language: SourceLanguageId;
  content: string;

  /**
   * Optional known names used by heuristic parsers to avoid emitting
   * every identifier as a reference.
   */
  referenceCandidates?: readonly string[];

  abortSignal?: AbortSignal;
}

export type SourceParserStatus =
  | "complete"
  | "partial";

export interface SourceParserResult {
  parserId: string;
  language: SourceLanguageId;
  quality: SourceAnalysisQuality;
  status: SourceParserStatus;

  symbols: SourceAnalysisSymbol[];
  imports: SourceAnalysisImport[];
  references: SourceAnalysisReference[];
  warnings: SourceAnalysisWarning[];
}

export interface SourceParser {
  readonly id: string;
  readonly priority: number;

  supports(
    language: SourceLanguageId,
    relativePath: string,
  ): boolean;

  parse(
    input: SourceParserInput,
  ): Promise<SourceParserResult>;
}

export interface SourceParserResolution {
  language: SourceLanguageId;
  parsers: readonly SourceParser[];
}

/**
 * TREE-SITTER RUNTIME PORT
 *
 * Source Analysis does not own WASM loading or process-global grammar
 * caches. A host adapter implements this port.
 */

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

  supports(
    language: SourceLanguageId,
  ): boolean;

  parse(
    input: TreeSitterRuntimeParseInput,
  ): Promise<TreeSitterRuntimeParseResult>;
}

/**
 * ANALYSIS INPUT AND OUTPUT
 */

export interface SourceAnalysisInput {
  sourceId: string;
  file: WorkspaceFileEntry;
  content: string;

  /**
   * Explicit language overrides path-based detection.
   */
  language?: SourceLanguageId;

  referenceCandidates?: readonly string[];
  abortSignal?: AbortSignal;
}

export interface SourceAnalysis {
  schemaVersion: 1;

  sourceId: string;
  rootId: string;
  relativePath: string;

  language?: SourceLanguageId;
  languageSource: SourceLanguageDetectionSource;

  parserId?: string;
  quality: SourceAnalysisQuality;
  status: SourceAnalysisStatus;

  symbols: SourceAnalysisSymbol[];
  imports: SourceAnalysisImport[];
  references: SourceAnalysisReference[];
  warnings: SourceAnalysisWarning[];
}

export interface SourceAnalysisBuilderOptions {
  fallbackOnEmptyResult?: boolean;
}

export interface SourceAnalysisFactoryOptions {
  builder?:
    SourceAnalysisBuilderOptions;

  languageDetector?:
    SourceLanguageDetectorOptions;

  treeSitterRuntime?:
    TreeSitterRuntimePort;
}

export interface SourceAnalysisNormalizationInput {
  sourceId: string;
  rootId: string;
  relativePath: string;
  language: SourceLanguageId;
  languageSource: SourceLanguageDetectionSource;
  parserResult: SourceParserResult;
  precedingWarnings: readonly SourceAnalysisWarning[];
}

/**
 * LOCAL FACT IDENTITIES
 */

export interface SourceSymbolLocalIdInput {
  kind: string;
  name: string;
  startLine: number;
  ordinal?: number;
}
