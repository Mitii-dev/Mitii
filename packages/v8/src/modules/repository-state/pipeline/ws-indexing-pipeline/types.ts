import type {
  ChunkingOptions,
  ChunkingResult,
  ChunkingServicePort,
} from "../../internal/chunking/types";

import type {
  CodeIndexCoordinatorResult,
  CodeIndexFileLocator,
  CodeIndexFileState,
  CodeIndexPreparedFileIndexerPort,
  CodeIndexRemoveMissingInput,
  CodeIndexRemoveMissingResult,
  CodeIndexWriteContext,
} from "../../internal/code-indexing/types";

import type {
  EmbeddingSynchronizationResult,
  EmbeddingSynchronizerInput,
} from "../../internal/embedding/types";

import type {
  SourceAnalysis,
  SourceAnalysisInput,
  SourceFileContent,
  SourceFileReaderInput,
} from "../../internal/source-analysis/types";

import type {
  TextIndexCoordinatorInput,
  TextIndexCoordinatorResult,
  TextIndexDocumentLocator,
  TextIndexDocumentState,
  TextIndexRemoveMissingInput,
  TextIndexRemoveMissingResult,
  TextIndexWriteContext,
} from "../../internal/text-index/types";

import type {
  WorkspaceFileEntry,
  WorkspaceRoot,
  WorkspaceSnapshot,
} from "../../internal/workspace/types";

export type WorkspaceIndexingFailureMode =
  | "best_effort"
  | "fail_fast";

export interface WorkspaceIndexingPipelineInput {
  workspace: string;
  snapshot: WorkspaceSnapshot;

  /**
   * Supplied by the Engine clock to keep V8 deterministic.
   */
  indexedAt: number;

  rootIds?: readonly string[];
  filePaths?: readonly string[];

  maximumFiles?: number;
  concurrency?: number;
  maximumReportedFileResults?: number;

  analysisVersion?: string;
  textPipelineVersion?: string;
  chunkingOptions?: ChunkingOptions;

  failureMode?: WorkspaceIndexingFailureMode;
  cleanupMissing?: boolean;
  synchronizeEmbeddings?: boolean;

  abortSignal?: AbortSignal;
}

export interface NormalizedWorkspaceIndexingPipelineInput {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  indexedAt: number;

  rootIds: string[];
  filePaths: string[];

  maximumFiles: number;
  concurrency: number;
  maximumReportedFileResults: number;

  analysisVersion: string;
  textPipelineVersion: string;
  chunkingOptions: ChunkingOptions;

  failureMode: WorkspaceIndexingFailureMode;
  cleanupMissing: boolean;
  synchronizeEmbeddings: boolean;

  abortSignal?: AbortSignal;
}

export type WorkspaceIndexingStage =
  | "selection"
  | "read"
  | "analysis"
  | "content_hash"
  | "chunking"
  | "code_index"
  | "text_index"
  | "cleanup"
  | "embedding";

export type WorkspaceIndexingWarningCode =
  | "file_policy_failed"
  | "file_stage_failed"
  | "cleanup_skipped"
  | "cleanup_failed"
  | "embedding_failed"
  | "file_limit_reached"
  | "file_results_truncated"
  | "cancelled";

export interface WorkspaceIndexingWarning {
  stage: WorkspaceIndexingStage;
  code: WorkspaceIndexingWarningCode;
  message: string;

  rootId?: string;
  relativePath?: string;
}

export interface WorkspaceIndexingFilePolicyDecision {
  included: boolean;
  reason?: string;
  language?: string;
}

export interface WorkspaceIndexingFilePolicyPort {
  evaluate(
    file: WorkspaceFileEntry,
  ):
    | WorkspaceIndexingFilePolicyDecision
    | Promise<WorkspaceIndexingFilePolicyDecision>;
}

export interface SelectedWorkspaceIndexingFile {
  file: WorkspaceFileEntry;
  sourceId: string;
  language?: string;
}

export interface SkippedWorkspaceIndexingFile {
  rootId: string;
  relativePath: string;
  reason: string;
}

export interface WorkspaceIndexingFileSelection {
  availableFiles: number;
  selected: SelectedWorkspaceIndexingFile[];
  skipped: SkippedWorkspaceIndexingFile[];
  truncated: boolean;
  warnings: WorkspaceIndexingWarning[];
  retainedRelativePathsByRoot: ReadonlyMap<
    string,
    readonly string[]
  >;
}

export type WorkspaceIndexingFileStatus =
  | "complete"
  | "partial"
  | "failed"
  | "cancelled";

export interface WorkspaceIndexingFileResult {
  rootId: string;
  relativePath: string;
  sourceId: string;

  status: WorkspaceIndexingFileStatus;

  analysisStatus?: SourceAnalysis["status"];
  analysisWarnings: number;

  chunkingStatus?: ChunkingResult["status"];
  chunkingWarnings: number;
  emittedChunks: number;
  estimatedTokens: number;

  codeIndexStatus?: CodeIndexCoordinatorResult["status"];
  codeIndexChanged: boolean;
  textIndexStatus?: TextIndexCoordinatorResult["status"];
  textIndexChanged: boolean;
  contentHash?: string;

  warnings: WorkspaceIndexingWarning[];
}

export interface WorkspaceIndexingFileProcessorInput {
  request: NormalizedWorkspaceIndexingPipelineInput;
  selected: SelectedWorkspaceIndexingFile;
}

export interface WorkspaceIndexingSourceReaderPort {
  read(
    input: SourceFileReaderInput,
  ): Promise<SourceFileContent>;
}

export interface WorkspaceIndexingSourceAnalyzerPort {
  analyze(
    input: SourceAnalysisInput,
  ): Promise<SourceAnalysis>;
}

export interface WorkspaceIndexingContentHasherPort {
  readonly id: string;
  hash(
    content: string,
  ): string | Promise<string>;
}

export interface WorkspaceIndexingTextIndexerPort {
  index(
    input: TextIndexCoordinatorInput,
  ): Promise<TextIndexCoordinatorResult>;
}

export interface WorkspaceIndexingFreshnessPort {
  getCodeFileState(
    file: CodeIndexFileLocator,
    context?: CodeIndexWriteContext,
  ): Promise<CodeIndexFileState | null>;

  getTextDocumentState(
    document: TextIndexDocumentLocator,
    context?: TextIndexWriteContext,
  ): Promise<TextIndexDocumentState | null>;
}

export interface WorkspaceIndexingCodeIndexMaintenancePort {
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

export interface WorkspaceIndexingTextIndexMaintenancePort {
  removeMissingDocuments(
    input: TextIndexRemoveMissingInput,
    context?: TextIndexWriteContext,
  ): Promise<TextIndexRemoveMissingResult>;

  getRevision?(
    workspace: string,
    rootId: string,
    context?: TextIndexWriteContext,
  ): Promise<number>;
}

export interface WorkspaceIndexingEmbeddingSynchronizerPort {
  synchronize(
    input: EmbeddingSynchronizerInput,
  ): Promise<EmbeddingSynchronizationResult>;
}

export interface WorkspaceIndexingFileProcessorDependencies {
  reader: WorkspaceIndexingSourceReaderPort;
  analyzer: WorkspaceIndexingSourceAnalyzerPort;
  contentHasher: WorkspaceIndexingContentHasherPort;
  chunker: ChunkingServicePort;
  codeIndexer: CodeIndexPreparedFileIndexerPort;
  textIndexer: WorkspaceIndexingTextIndexerPort;
  freshness?: WorkspaceIndexingFreshnessPort;
}

export interface WorkspaceIndexingRootFinalizerDependencies {
  codeIndex:
    WorkspaceIndexingCodeIndexMaintenancePort;
  textIndex:
    WorkspaceIndexingTextIndexMaintenancePort;
  embedding:
    WorkspaceIndexingEmbeddingSynchronizerPort;
}

export type WorkspaceIndexingRootStatus =
  | "complete"
  | "partial"
  | "skipped"
  | "cancelled";

export interface WorkspaceIndexingRootResult {
  rootId: string;
  status: WorkspaceIndexingRootStatus;

  cleanupPerformed: boolean;
  codeIndexRemovedFiles: number;
  textIndexRemovedDocuments: number;
  textIndexRemovedChunks: number;

  codeIndexRevision?: number;

  embeddingStatus?: EmbeddingSynchronizationResult["status"];
  embeddingProfileId?: string;
  initialTextRevision?: number;
  finalTextRevision?: number;
  latestTextRevision?: number;
  embeddedChunks: number;
  vectorsDeleted: number;

  warnings: WorkspaceIndexingWarning[];
}

export interface WorkspaceIndexingRootFinalizerInput {
  request: NormalizedWorkspaceIndexingPipelineInput;
  roots: readonly WorkspaceRoot[];
  cleanupAllowed: boolean;
  retainedRelativePathsByRoot: ReadonlyMap<
    string,
    readonly string[]
  >;
}

export type WorkspaceIndexingPipelineStatus =
  | "complete"
  | "partial"
  | "empty"
  | "failed"
  | "cancelled";

export interface WorkspaceIndexingPipelineStatistics {
  availableFiles: number;
  selectedFiles: number;
  skippedFiles: number;
  processedFiles: number;

  completeFiles: number;
  partialFiles: number;
  failedFiles: number;
  cancelledFiles: number;

  analysisFailures: number;
  emittedChunks: number;
  estimatedTokens: number;

  codeIndexUpdates: number;
  textIndexUpdates: number;
  embeddedChunks: number;

  removedCodeIndexFiles: number;
  removedTextIndexDocuments: number;
  removedTextIndexChunks: number;

  reportedFileResults: number;
}

export interface WorkspaceIndexingPipelineResult {
  schemaVersion: 1;

  workspace: string;
  workspaceSnapshotId: string;
  indexedAt: number;

  status: WorkspaceIndexingPipelineStatus;

  fileResults: WorkspaceIndexingFileResult[];
  fileResultsTruncated: boolean;
  rootResults: WorkspaceIndexingRootResult[];
  warnings: WorkspaceIndexingWarning[];

  cleanupAllowed: boolean;
  statistics: WorkspaceIndexingPipelineStatistics;
}

export interface WorkspaceIndexingPipelineDependencies
  extends WorkspaceIndexingFileProcessorDependencies,
    WorkspaceIndexingRootFinalizerDependencies {
  filePolicy?: WorkspaceIndexingFilePolicyPort;
}
