import type { WorkspaceSnapshot } from "../workspace";

/**
 * CODE INDEX FILES
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

  exported?: boolean;
  signature?: string;

  startLine?: number;
  endLine?: number;
}

export interface CodeIndexReference {
  fromFileId: string;

  symbolName: string;

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


/**
 * SQLITE READ PORT
 */

export interface SqlitePreparedStatementPort {
  get(...parameters: unknown[]): unknown;

  all(...parameters: unknown[]): unknown[];
}

export interface SqliteReadPort {
  prepare(sql: string): SqlitePreparedStatementPort;
}

/**
 * SQLITE ADAPTER OPTIONS
 */

export interface SqliteCodeIndexAdapterOptions {
  workspace: string;

  /**
   * WorkspaceRoot.id represented by this SQLite workspace.
   */
  rootId: string;

  sqlBatchSize?: number;
}

/**
 * SQLITE DATABASE ROWS
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
}

export interface SqliteCodeIndexImportRow {
  fromFileId: number;

  targetFileId: number | null;
  targetRelativePath: string | null;
}

export interface SqliteCodeIndexReferenceRow {
  fromFileId: number;

  symbolName: string;

  targetSymbolId: number | null;
  targetFileId: number | null;
}

export interface SqliteCodeIndexWatermarkRow {
  watermark: number | null;
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

export interface CodeIndexSymbolQuery {
  fileIds: readonly string[];

  /**
   * Hard adapter-level safety limit per file.
   */
  maximumSymbolsPerFile: number;

  kinds?: readonly string[];
  namePrefix?: string;
}

export interface CodeIndexResolvedImport {
  resolution: "resolved";

  fromFileId: string;
  toFileId: string;

  /**
   * Canonical workspace-relative path of the resolved target.
   */
  resolvedRelativePath: string;

  /**
   * Original import specifier.
   *
   * Example: "../utils" or "@app/auth"
   */
  specifier?: string;

  importedNames: string[];
}

export interface CodeIndexUnresolvedImport {
  resolution: "unresolved";

  fromFileId: string;

  /**
   * Original import specifier.
   */
  specifier?: string;

  /**
   * Best-effort path produced by the indexer when resolution
   * did not produce a file inside the current snapshot.
   */
  candidateRelativePath?: string;

  importedNames: string[];
}

export type CodeIndexImport =
  | CodeIndexResolvedImport
  | CodeIndexUnresolvedImport;
