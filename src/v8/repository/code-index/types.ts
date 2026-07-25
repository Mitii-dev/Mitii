import type { WorkspaceSnapshot } from "../workspace";

/**
 * CODE INDEX FACTS
 */

export interface CodeIndexFile {
  id: string;
  rootId: string;
  relativePath: string;
  language?: string;
  size?: number;
  modifiedAt?: string;
  contentHash?: string;
}

export interface CodeIndexSymbol {
  id: string;
  fileId: string;
  name: string;
  kind: string;
  parentSymbolId?: string;
  exported?: boolean;
  signature?: string;
  startLine?: number;
  endLine?: number;
}

export interface CodeIndexResolvedImport {
  resolution: "resolved";
  fromFileId: string;
  toFileId: string;
  resolvedRelativePath: string;
  specifier: string;
  line?: number;
  importedNames: string[];
}

export interface CodeIndexUnresolvedImport {
  resolution: "unresolved";
  fromFileId: string;
  specifier: string;
  line?: number;
  candidateRelativePath?: string;
  importedNames: string[];
}

export type CodeIndexImport =
  | CodeIndexResolvedImport
  | CodeIndexUnresolvedImport;

export type CodeIndexReferenceResolution =
  | "resolved"
  | "ambiguous"
  | "unresolved";

export interface CodeIndexReference {
  fromFileId: string;
  symbolName: string;
  line?: number;
  resolution: CodeIndexReferenceResolution;
  toFileId?: string;
  toSymbolId?: string;
}

/**
 * CODE INDEX QUERYING
 */

export interface CodeIndexContext {
  snapshot: WorkspaceSnapshot;
  abortSignal?: AbortSignal;
}

export interface CodeIndexFileQuery {
  rootIds?: readonly string[];
  folderPrefix?: string;
  maximumFiles: number;
}

export interface CodeIndexFileQueryResult {
  files: readonly CodeIndexFile[];
  totalAvailable: number;
  truncated: boolean;
}

export interface CodeIndexSymbolQuery {
  fileIds: readonly string[];
  maximumSymbolsPerFile: number;
  kinds?: readonly string[];
  namePrefix?: string;
}

export interface CodeIndexSymbolQueryResult {
  symbolsByFile: ReadonlyMap<
    string,
    readonly CodeIndexSymbol[]
  >;
  truncatedFileIds: readonly string[];
}

/**
 * CODE INDEX PORT
 */

export interface CodeIndexReadPort {
  readonly id: string;

  getChangeToken(
    context: CodeIndexContext,
  ): Promise<string>;

  getFiles(
    query: CodeIndexFileQuery,
    context: CodeIndexContext,
  ): Promise<CodeIndexFileQueryResult>;

  getSymbols(
    query: CodeIndexSymbolQuery,
    context: CodeIndexContext,
  ): Promise<CodeIndexSymbolQueryResult>;

  getImports(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<readonly CodeIndexImport[]>;

  getReferences(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<readonly CodeIndexReference[]>;
}

/**
 * STABLE IDENTITIES
 */

export interface CodeIndexFileIdentityInput {
  rootId: string;
  relativePath: string;
}

export interface CodeIndexFileIdentity {
  rootId: string;
  relativePath: string;
}

export interface CodeIndexSymbolIdentityInput {
  fileId: string;
  kind: string;
  name: string;
  startLine?: number;
}

/**
 * SQLITE PORT
 */

export interface SqlitePreparedStatementPort {
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

export interface SqliteReadPort {
  prepare(sql: string): SqlitePreparedStatementPort;
}

export interface SqliteCodeIndexAdapterOptions {
  workspace: string;
  rootId: string;
  sqlBatchSize?: number;
}

/**
 * SQLITE ROWS
 *
 * These are adapter transport types. SQLite numeric identifiers never
 * become public Code Index identifiers.
 */

export interface SqliteCodeIndexFileRow {
  id: number;
  relativePath: string;
  indexedAt: number | null;
}

export interface SqliteCodeIndexSymbolRow {
  id: number;
  fileId: number;
  name: string;
  kind: string;
  signature: string | null;
  startLine: number | null;
  endLine: number | null;
  parentName: string | null;
  parentKind: string | null;
  parentStartLine: number | null;
}

export interface SqliteCodeIndexImportRow {
  fromFileId: number;
  targetFileId: number | null;
  targetRelativePath: string | null;
  specifier: string;
  line: number;
}

export interface SqliteCodeIndexReferenceRow {
  fromFileId: number;
  symbolName: string;
  line: number;
  targetFileId: number | null;
  targetRelativePath: string | null;
  targetSymbolName: string | null;
  targetSymbolKind: string | null;
  targetSymbolStartLine: number | null;
}

export interface SqliteCodeIndexWatermarkRow {
  fileCount: number;
  indexedAtMaximum: number | null;
  indexedAtSum: number | null;
  idSum: number | null;
}

/**
 * ERRORS
 */

export type CodeIndexOperation =
  | "get_change_token"
  | "get_files"
  | "get_symbols"
  | "get_imports"
  | "get_references";

export interface CodeIndexErrorOptions {
  operation: CodeIndexOperation;
  adapterId: string;
  cause?: unknown;
}

