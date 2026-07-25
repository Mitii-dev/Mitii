import type {
  SourceAnalysis,
  SourceAnalysisImport,
  SourceAnalysisReference,
  SourceAnalysisStatus,
  SourceAnalysisSymbol,
  SourceAnalysisQuality,
  SourceFileContent,
} from "../source-analysis/types";

import type {
  WorkspaceFileEntry,
  WorkspaceSnapshot,
} from "../workspace";

/**
 * FILE VERSION AND PERSISTED DOCUMENT
 */

export interface CodeIndexFileLocator {
  workspace: string;
  rootId: string;
  relativePath: string;
}

export interface CodeIndexFileVersion
  extends CodeIndexFileLocator {
  providerPath?: string;
  language?: string;

  contentHash: string;
  size: number;
  modifiedAt?: string;

  /**
   * Version of the source-analysis pipeline and its configuration.
   *
   * Increment this value when parser behavior changes and unchanged
   * source files must be re-indexed.
   */
  analysisVersion: string;
}

export interface CodeIndexDocumentSymbol
  extends SourceAnalysisSymbol {}

export interface CodeIndexDocumentImport
  extends SourceAnalysisImport {
  resolution: "resolved" | "unresolved";

  /**
   * Present only when the import resolves to a file in the same
   * workspace root and current WorkspaceSnapshot.
   */
  targetRelativePath?: string;

  /**
   * Best-effort canonical path for an unresolved relative import.
   */
  candidateRelativePath?: string;
}

export interface CodeIndexDocumentReference
  extends SourceAnalysisReference {}

export interface CodeIndexDocument {
  schemaVersion: 1;

  file: CodeIndexFileVersion;

  sourceAnalysisSchemaVersion: 1;
  sourceId: string;
  parserId?: string;
  quality: SourceAnalysisQuality;
  status: Exclude<SourceAnalysisStatus, "failed">;

  symbols: CodeIndexDocumentSymbol[];
  imports: CodeIndexDocumentImport[];
  references: CodeIndexDocumentReference[];

  indexedAt: number;
  workspaceSnapshotId: string;
}

/**
 * CURRENT INDEX STATE
 */

export interface CodeIndexFileState
  extends CodeIndexFileLocator {
  contentHash: string;
  size: number;
  modifiedAt?: string;
  language?: string;
  providerPath?: string;

  analysisVersion: string;
  analysisStatus:
    | "complete"
    | "partial"
    | "unsupported";
  indexedAt: number;
}

/**
 * UPDATE PLANNING
 */

export type CodeIndexUpdateAction =
  | "insert"
  | "replace"
  | "refresh_metadata"
  | "skip"
  | "remove";

export type CodeIndexUpdateReason =
  | "file_not_indexed"
  | "content_changed"
  | "analysis_version_changed"
  | "analysis_status_changed"
  | "metadata_changed"
  | "unchanged"
  | "file_removed";

export interface CodeIndexUpdatePlan {
  action: CodeIndexUpdateAction;
  reason: CodeIndexUpdateReason;
}

export interface CodeIndexUpdatePlannerInput {
  desired?: CodeIndexFileVersion & {
    analysisStatus:
      | "complete"
      | "partial"
      | "unsupported";
  };

  current: CodeIndexFileState | null;
  removed?: boolean;
}

/**
 * WRITING
 */

export interface CodeIndexWriteContext {
  abortSignal?: AbortSignal;
}

export interface CodeIndexWriteCounts {
  symbols: number;
  imports: number;
  references: number;
}

export interface CodeIndexWriteResult {
  action:
    | "inserted"
    | "replaced"
    | "metadata_refreshed"
    | "removed"
    | "not_found";

  file: CodeIndexFileLocator;
  revision: number;
  counts: CodeIndexWriteCounts;
}

export interface CodeIndexRemoveMissingInput {
  workspace: string;
  rootId: string;
  retainedRelativePaths: readonly string[];
  workspaceSnapshotId: string;
  changedAt: number;
}

export interface CodeIndexRemoveMissingResult {
  removedRelativePaths: string[];
  revision: number;
}

export interface CodeIndexWritePort {
  readonly id: string;

  getFileState(
    file: CodeIndexFileLocator,
    context?: CodeIndexWriteContext,
  ): Promise<CodeIndexFileState | null>;

  replaceDocument(
    document: CodeIndexDocument,
    context?: CodeIndexWriteContext,
  ): Promise<CodeIndexWriteResult>;

  refreshFileMetadata(
    file: CodeIndexFileVersion,
    workspaceSnapshotId: string,
    changedAt: number,
    context?: CodeIndexWriteContext,
  ): Promise<CodeIndexWriteResult>;

  removeFile(
    file: CodeIndexFileLocator,
    workspaceSnapshotId: string,
    changedAt: number,
    context?: CodeIndexWriteContext,
  ): Promise<CodeIndexWriteResult>;

  removeMissingFiles(
    input: CodeIndexRemoveMissingInput,
    context?: CodeIndexWriteContext,
  ): Promise<CodeIndexRemoveMissingResult>;

  getRevision(
    workspace: string,
    rootId: string,
    context?: CodeIndexWriteContext,
  ): Promise<number>;
}

/**
 * MAPPING AND IMPORT RESOLUTION
 */

export interface CodeIndexImportResolutionInput {
  importerRootId: string;
  importerRelativePath: string;
  specifier: string;
  snapshot: WorkspaceSnapshot;
}

export interface CodeIndexImportResolution {
  resolution: "resolved" | "unresolved";
  targetRelativePath?: string;
  candidateRelativePath?: string;
}

export interface CodeIndexDocumentMapperInput {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  file: WorkspaceFileEntry;
  contentHash: string;
  analysisVersion: string;
  analysis: SourceAnalysis;
  indexedAt: number;
}

/**
 * UPDATER
 */

export type CodeIndexUpdateStatus =
  | "indexed"
  | "metadata_refreshed"
  | "unchanged"
  | "removed"
  | "not_found";

export interface CodeIndexUpdateResult {
  status: CodeIndexUpdateStatus;
  plan: CodeIndexUpdatePlan;
  write?: CodeIndexWriteResult;
}

export interface CodeIndexUpdaterInput {
  document: CodeIndexDocument;
  abortSignal?: AbortSignal;
}

export interface CodeIndexRemovalInput {
  file: CodeIndexFileLocator;
  workspaceSnapshotId: string;
  changedAt: number;
  abortSignal?: AbortSignal;
}

/**
 * COORDINATOR PORTS AND RESULT
 */

export interface CodeIndexSourceReader {
  read(input: {
    sourceId: string;
    file: WorkspaceFileEntry;
  }): Promise<SourceFileContent>;
}

export interface CodeIndexSourceAnalyzer {
  analyze(input: {
    sourceId: string;
    file: WorkspaceFileEntry;
    content: string;
    language?: string;
    referenceCandidates?: readonly string[];
    abortSignal?: AbortSignal;
  }): Promise<SourceAnalysis>;
}

export interface CodeIndexContentHasher {
  hash(content: string): string | Promise<string>;
}

export interface CodeIndexCoordinatorInput {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  file: WorkspaceFileEntry;

  sourceId?: string;
  language?: string;
  analysisVersion?: string;
  referenceCandidates?: readonly string[];

  /**
   * Supplied by the engine clock. Keeping time outside this library
   * makes input/output tests deterministic.
   */
  indexedAt: number;

  abortSignal?: AbortSignal;
}

export type CodeIndexCoordinatorStatus =
  | "indexed"
  | "metadata_refreshed"
  | "unchanged"
  | "unsupported"
  | "analysis_failed";

export interface CodeIndexCoordinatorResult {
  status: CodeIndexCoordinatorStatus;
  analysis: SourceAnalysis;
  update?: CodeIndexUpdateResult;
}

/**
 * SQLITE PORTS
 */

export interface SqliteCodeIndexRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteCodeIndexStatementPort {
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): SqliteCodeIndexRunResult;
}

export interface SqliteCodeIndexDatabasePort {
  prepare(sql: string): SqliteCodeIndexStatementPort;
  exec(sql: string): void;

  /**
   * Executes the callback atomically and rolls it back when the
   * callback throws.
   */
  transaction<T>(operation: () => T): T;
}

export interface SqliteCodeIndexWriterOptions {
  adapterId?: string;
}

export interface SqliteCodeIndexColumnRow {
  name: string;
}

export interface SqliteCodeIndexFileStateRow {
  workspace: string;
  rootId: string;
  relativePath: string;
  providerPath: string | null;
  hash: string;
  size: number;
  modifiedAt: number | null;
  language: string | null;
  analysisVersion: string;
  analysisStatus:
    | "complete"
    | "partial"
    | "unsupported";
  indexedAt: number;
}

export interface SqliteCodeIndexFileIdRow {
  id: number;
}

export interface SqliteCodeIndexRevisionRow {
  revision: number;
}

/**
 * MIGRATION
 */

export interface CodeIndexMigrationResult {
  schemaVersion: number;
  addedColumns: string[];
}

/**
 * ERRORS
 */

export type CodeIndexWriteOperation =
  | "migrate"
  | "get_file_state"
  | "replace_document"
  | "refresh_metadata"
  | "remove_file"
  | "remove_missing_files"
  | "get_revision";

export interface CodeIndexWriteErrorOptions {
  operation: CodeIndexWriteOperation;
  adapterId: string;
  cause?: unknown;
}
