import type {
  ChunkTokenEstimator,
} from "../../../repository-state/index";

import type {
  ContextCandidateOrigin,
  ContextReferencePriority,
  ContextRepresentation,
  ContextSelectionResult,
  ContextSelectionScoreSignal,
  SelectedContextItem,
} from "../context-selection/types";

import type {
  FileSystemReadPort,
} from "../../../repository-state/index";

import type {
  WorkspaceSnapshot,
} from "../../../repository-state/index";

/**
 * REQUEST
 */

export interface ContextAssemblyInput {
  selection: ContextSelectionResult;
  snapshot: WorkspaceSnapshot;
  folderPrefix?: string;
  abortSignal?: AbortSignal;
}

export type ContextAssemblyStatus =
  | "complete"
  | "partial"
  | "empty"
  | "cancelled"
  | "failed";

/**
 * CONTENT SOURCE PORT
 */

export type ContextContentSourceStatus =
  | "loaded"
  | "not_found"
  | "unavailable";

export interface ContextContentSourceRequest {
  item: SelectedContextItem;
  representation: ContextRepresentation;
  maximumBytes: number;
}

export interface ContextContentSourceContext {
  snapshot: WorkspaceSnapshot;
  abortSignal?: AbortSignal;
}

export interface ContextContentSourceResult {
  status: ContextContentSourceStatus;

  /**
   * Required when status is "loaded".
   */
  content?: string;

  /**
   * The representation actually returned by the source.
   */
  representation?: ContextRepresentation;

  startLine?: number;
  endLine?: number;
  contentHash?: string;

  message?: string;
}

export interface ContextContentSource {
  readonly id: string;
  readonly priority: number;

  supports(request: ContextContentSourceRequest): boolean;

  load(
    request: ContextContentSourceRequest,
    context: ContextContentSourceContext,
  ): Promise<ContextContentSourceResult>;
}

export interface ContextContentSourceRegistryPort {
  register(source: ContextContentSource): void;
  unregister(sourceId: string): boolean;

  freeze(): void;
  isFrozen(): boolean;

  list(): readonly ContextContentSource[];
  resolve(request: ContextContentSourceRequest): readonly ContextContentSource[];
}

export type ContextContentLoadAttemptStatus =
  | "not_found"
  | "unavailable"
  | "failed";

export interface ContextContentLoadAttempt {
  sourceId: string;
  representation: ContextRepresentation;
  status: ContextContentLoadAttemptStatus;
  message: string;
}

export type ContextContentLoadStatus =
  | "loaded"
  | "unavailable"
  | "failed"
  | "cancelled";

export interface LoadedContextContent {
  sourceId: string;
  requestedRepresentation: ContextRepresentation;
  representation: ContextRepresentation;

  content: string;

  startLine?: number;
  endLine?: number;
  contentHash?: string;

  fallbackUsed: boolean;
}

export interface ContextContentLoadResult {
  status: ContextContentLoadStatus;
  loaded?: LoadedContextContent;
  attempts: ContextContentLoadAttempt[];
}

export interface ContextContentLoaderInput {
  item: SelectedContextItem;
  snapshot: WorkspaceSnapshot;
  maximumBytes: number;
  allowRepresentationFallback: boolean;
  abortSignal?: AbortSignal;
}

/**
 * WORKSPACE FILE SOURCE
 */

export interface WorkspaceFileContextSourceDependencies {
  fileSystem: FileSystemReadPort;
}

export interface WorkspaceFileContextSourceOptions {
  targetedExcerptContextLines?: number;
}

export interface ResolvedWorkspaceFileContextSourceOptions {
  targetedExcerptContextLines: number;
}

/**
 * SAFETY
 */

export type SensitiveContextPathMode =
  | "block"
  | "redact";

export interface ContextSensitivePathDecision {
  sensitive: boolean;
  matchedRule?: string;
}

export interface ContextSecretPattern {
  id: string;
  pattern: RegExp;
  replacement: string;
}

export interface ContextSecretRedaction {
  patternId: string;
  count: number;
}

export interface ContextSecretRedactionResult {
  content: string;
  redactions: ContextSecretRedaction[];
}

export interface ContextTextSanitizationResult {
  content: string;
  removedControlCharacters: number;
  normalizedLineEndings: boolean;
}

/**
 * TRUNCATION
 */

export type ContextTruncationStrategy =
  | "head"
  | "head_tail";

export interface ContextLineRange {
  startLine: number;
  endLine: number;
}

export interface ContextTextTruncationInput {
  content: string;
  maximumTokens: number;
  representation: ContextRepresentation;
  startLine?: number;
  endLine?: number;
}

export interface ContextTextTruncationResult {
  content: string;
  tokenEstimate: number;
  truncated: boolean;
  omittedCharacters: number;
  lineRanges: ContextLineRange[];
}

export interface ContextBlockIdInput {
  sourceId: string;
  rootId?: string;
  relativePath: string;
  representation: ContextRepresentation;
  lineRanges: readonly ContextLineRange[];
}

export interface ContextBlockBuildInput {
  item: SelectedContextItem;
  loaded: LoadedContextContent;

  content: string;
  tokenEstimate: number;

  lineRanges: ContextLineRange[];
  truncated: boolean;
  omittedCharacters: number;

  redactions: ContextSecretRedaction[];
}

/**
 * OUTPUT
 */

export type ContextContentTrust =
  "untrusted_repository_content";

export interface ContextBlockProvenance {
  selectionKey: string;
  selectionOrder: number;

  origins: ContextCandidateOrigin[];
  priority: ContextReferencePriority;

  score: number;
  signals: ContextSelectionScoreSignal[];

  retrievalSourceIds: string[];
}

export interface ContextBlock {
  id: string;
  trust: ContextContentTrust;

  sourceId: string;

  rootId?: string;
  relativePath: string;

  chunkId?: string;
  symbolId?: string;

  requestedRepresentation: ContextRepresentation;
  representation: ContextRepresentation;

  content: string;
  contentHash?: string;

  lineRanges: ContextLineRange[];

  allocatedTokens: number;
  tokenEstimate: number;

  truncated: boolean;
  omittedCharacters: number;

  redactions: ContextSecretRedaction[];
  provenance: ContextBlockProvenance;
}

export type ContextAssemblyDropCause =
  | "sensitive_path"
  | "content_not_found"
  | "content_unavailable"
  | "content_source_failed"
  | "empty_content"
  | "duplicate_block"
  | "required_content_omitted";

export interface DroppedContextBlock {
  selectionKey: string;
  relativePath: string;
  priority: ContextReferencePriority;
  cause: ContextAssemblyDropCause;
  evidence: string;
}

export type ContextAssemblyWarningCode =
  | "selection_partial"
  | "selection_failed"
  | "selection_cancelled"
  | "workspace_snapshot_partial"
  | "sensitive_path_blocked"
  | "content_not_found"
  | "content_unavailable"
  | "content_source_failed"
  | "representation_fallback"
  | "file_map_fallback"
  | "content_sanitized"
  | "secrets_redacted"
  | "content_truncated"
  | "empty_content"
  | "duplicate_block_removed"
  | "required_content_omitted"
  | "cancelled";

export interface ContextAssemblyWarning {
  code: ContextAssemblyWarningCode;
  message: string;

  count?: number;
  selectionKey?: string;
  relativePath?: string;
  sourceId?: string;
}

export interface ContextAssemblyBudgetUsage {
  allocatedTokens: number;
  usedTokens: number;
  remainingTokens: number;
}

export interface ContextAssemblyStatistics {
  selectedItems: number;
  attemptedItems: number;

  assembledBlocks: number;
  droppedBlocks: number;

  loadedFiles: number;
  loadedRoots: number;

  truncatedBlocks: number;
  fallbackBlocks: number;
  redactedBlocks: number;
  redactionCount: number;

  inputCharacters: number;
  outputCharacters: number;
}

export interface ContextAssemblyResult {
  schemaVersion: 1;

  workspaceSnapshotId: string;
  selectionStatus: ContextSelectionResult["status"];
  status: ContextAssemblyStatus;

  blocks: ContextBlock[];
  dropped: DroppedContextBlock[];
  warnings: ContextAssemblyWarning[];

  budget: ContextAssemblyBudgetUsage;
  statistics: ContextAssemblyStatistics;
}

/**
 * OPTIONS AND FACTORY
 */

export type RequiredContextLoadFailureMode =
  | "partial"
  | "fail";

export interface ContextAssemblerOptions {
  maximumBytesPerItem?: number;

  requiredLoadFailureMode?: RequiredContextLoadFailureMode;
  sensitivePathMode?: SensitiveContextPathMode;

  redactSecrets?: boolean;
  allowRepresentationFallback?: boolean;
}

export interface ResolvedContextAssemblerOptions {
  maximumBytesPerItem: number;

  requiredLoadFailureMode: RequiredContextLoadFailureMode;
  sensitivePathMode: SensitiveContextPathMode;

  redactSecrets: boolean;
  allowRepresentationFallback: boolean;
}

export interface ContextAssemblyFactoryDependencies {
  fileSystem: FileSystemReadPort;
  tokenEstimator?: ChunkTokenEstimator;
  additionalSources?: readonly ContextContentSource[];
}

export interface ContextAssemblyModule {
  assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult>;
}

/**
 * ERRORS
 */

export type ContextAssemblyOperation =
  | "resolve_options"
  | "register_source"
  | "load_content"
  | "sanitize_content"
  | "redact_content"
  | "truncate_content"
  | "build_block"
  | "assemble";

export interface ContextAssemblyErrorOptions {
  operation: ContextAssemblyOperation;
  componentId: string;
  cause?: unknown;
}
