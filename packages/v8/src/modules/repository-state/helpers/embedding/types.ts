import type {
  Chunk,
  ChunkKind,
} from "../chunking/types";

import type {
  TextIndexChange,
  TextIndexReadPort,
} from "../text-index/types";

/**
 * EMBEDDING PROVIDER
 */

export interface EmbeddingProfile {
  /**
   * Stable, storage-safe identifier for this exact embedding space.
   *
   * Change this value whenever the model, dimensions, pooling, or
   * normalization behavior changes.
   */
  id: string;

  providerId: string;
  modelId: string;
  dimensions: number;

  /**
   * Whether vectors in this embedding space are stored with L2
   * normalization. EmbeddingGenerator enforces this setting.
   */
  normalized: boolean;
}

export interface EmbeddingProviderContext {
  abortSignal?: AbortSignal;
}

export interface EmbeddingProvider {
  readonly profile: EmbeddingProfile;

  /**
   * Returns exactly one vector for every input text, in input order.
   *
   * Provider failures are errors. This module never silently switches
   * to a lower-quality fallback embedding space.
   */
  embed(
    texts: readonly string[],
    context?: EmbeddingProviderContext,
  ): Promise<readonly (readonly number[])[]>;

  /**
   * Optional cleanup for providers that hold native/WASM sessions.
   * Safe to omit for pure-JS providers.
   */
  dispose?(): void | Promise<void>;
}

/**
 * CONTENT-ADDRESSED VECTOR CACHE
 *
 * Keyed by (profile.id, chunk.contentHash) so unchanged chunk bytes can
 * reuse vectors across snapshot/chunk id changes.
 */
export interface EmbeddingVectorCachePort {
  get(
    profileId: string,
    contentHash: string,
  ):
    | readonly number[]
    | undefined
    | Promise<readonly number[] | undefined>;

  set(
    profileId: string,
    contentHash: string,
    vector: readonly number[],
  ): void | Promise<void>;
}

/**
 * GENERATION
 */

export interface EmbeddingGenerationInput {
  chunks: readonly Chunk[];
  abortSignal?: AbortSignal;
}

export interface EmbeddingVectorRecord {
  chunkId: string;

  rootId: string;
  relativePath: string;

  kind: ChunkKind;
  ordinal: number;

  contentHash: string;
  tokenEstimate: number;

  startLine: number;
  endLine: number;

  title?: string;
  symbolLocalId?: string;

  profileId: string;
  vector: number[];
}

export type EmbeddingGenerationStatus =
  | "complete"
  | "cancelled";

export type EmbeddingGenerationWarningCode =
  | "input_truncated";

export interface EmbeddingGenerationWarning {
  code: EmbeddingGenerationWarningCode;
  chunkId: string;
  message: string;
}

export interface EmbeddingGenerationStatistics {
  requestedChunks: number;
  embeddedChunks: number;
  providerCalls: number;
  truncatedInputs: number;
}

export interface EmbeddingGenerationResult {
  schemaVersion: 1;
  status: EmbeddingGenerationStatus;
  profile: EmbeddingProfile;
  records: EmbeddingVectorRecord[];
  warnings: EmbeddingGenerationWarning[];
  statistics: EmbeddingGenerationStatistics;
}

export interface EmbeddingGeneratorOptions {
  batchSize?: number;
  maximumInputCharacters?: number;
  includeTitle?: boolean;
  normalizeVectors?: boolean;
  vectorCache?: EmbeddingVectorCachePort;
}

export interface ResolvedEmbeddingGeneratorOptions {
  batchSize: number;
  maximumInputCharacters: number;
  includeTitle: boolean;
  normalizeVectors: boolean;
}

export interface PreparedEmbeddingText {
  chunk: Chunk;
  text: string;
  truncated: boolean;
}

/**
 * CHANGE PLANNING
 */

export interface EmbeddingChangePlan {
  upsertChunkIds: string[];
  deleteChunkIds: string[];
  nextTextRevision: number;
}

export interface EmbeddingChangePlannerInput {
  changes: readonly TextIndexChange[];
  currentTextRevision: number;
}

/**
 * VECTOR WRITE PORT
 */

export interface EmbeddingIndexLocator {
  workspace: string;
  rootId: string;
  profileId: string;
}

export interface EmbeddingIndexState
  extends EmbeddingIndexLocator {
  providerId: string;
  modelId: string;
  dimensions: number;
  normalized: boolean;

  textRevision: number;
  updatedAt: number;
}

export interface EmbeddingIndexReadContext {
  abortSignal?: AbortSignal;
}

export interface EmbeddingIndexWriteContext {
  abortSignal?: AbortSignal;
}

export interface EmbeddingIndexWriteBatch
  extends EmbeddingIndexLocator {
  profile: EmbeddingProfile;

  expectedTextRevision: number;
  nextTextRevision: number;

  upserts: readonly EmbeddingVectorRecord[];
  deleteChunkIds: readonly string[];

  updatedAt: number;
}

export interface EmbeddingIndexWriteResult {
  action: "applied";
  previousTextRevision: number;
  textRevision: number;
  vectorsUpserted: number;
  vectorsDeleted: number;
}

export interface EmbeddingIndexWritePort {
  readonly id: string;

  /**
   * State is isolated by embedding profile. A new profile starts at
   * Text Index revision zero without deleting older profiles.
   */
  getState(
    locator: EmbeddingIndexLocator,
    context?: EmbeddingIndexReadContext,
  ): Promise<EmbeddingIndexState | null>;

  /**
   * Applies vector mutations and advances the Text Index checkpoint
   * atomically. Implementations must reject an unexpected revision.
   */
  applyBatch(
    batch: EmbeddingIndexWriteBatch,
    context?: EmbeddingIndexWriteContext,
  ): Promise<EmbeddingIndexWriteResult>;
}

/**
 * SYNCHRONIZATION
 */

export interface EmbeddingSynchronizerInput {
  workspace: string;
  rootId: string;
  updatedAt: number;
  abortSignal?: AbortSignal;
}

export type EmbeddingSynchronizationStatus =
  | "complete"
  | "unchanged"
  | "partial"
  | "cancelled";

export type EmbeddingSynchronizationWarningCode =
  | "missing_upsert_chunk"
  | "input_truncated"
  | "batch_limit_reached";

export interface EmbeddingSynchronizationWarning {
  code: EmbeddingSynchronizationWarningCode;
  message: string;
  chunkId?: string;
}

export interface EmbeddingSynchronizationStatistics {
  changeBatchesRead: number;
  writeBatchesApplied: number;
  changesRead: number;
  chunksEmbedded: number;
  vectorsDeleted: number;
  providerCalls: number;
  truncatedInputs: number;
}

export interface EmbeddingSynchronizationResult {
  schemaVersion: 1;
  status: EmbeddingSynchronizationStatus;

  workspace: string;
  rootId: string;
  profile: EmbeddingProfile;

  initialTextRevision: number;
  finalTextRevision: number;
  latestTextRevision: number;

  warnings: EmbeddingSynchronizationWarning[];
  statistics: EmbeddingSynchronizationStatistics;
}

export interface EmbeddingSynchronizerOptions {
  maximumChangesPerBatch?: number;
  maximumBatchesPerRun?: number;
}

export interface ResolvedEmbeddingSynchronizerOptions {
  maximumChangesPerBatch: number;
  maximumBatchesPerRun: number;
}

export interface EmbeddingSynchronizerDependencies {
  textIndex: TextIndexReadPort;
  vectorWriter: EmbeddingIndexWritePort;
  generator: {
    readonly profile:
      EmbeddingProfile;

    generate(
      input: EmbeddingGenerationInput,
    ): Promise<EmbeddingGenerationResult>;
  };
  planner?: {
    plan(
      input: EmbeddingChangePlannerInput,
    ): EmbeddingChangePlan;
  };
}

export interface EmbeddingFactoryDependencies {
  provider: EmbeddingProvider;
  textIndex: TextIndexReadPort;
  vectorWriter: EmbeddingIndexWritePort;
  vectorCache?: EmbeddingVectorCachePort;
}

export interface EmbeddingFactoryOptions {
  generator?:
    EmbeddingGeneratorOptions;
  synchronizer?:
    EmbeddingSynchronizerOptions;
}

export interface EmbeddingModule {
  generator: {
    readonly profile:
      EmbeddingProfile;

    generate(
      input:
        EmbeddingGenerationInput,
    ): Promise<EmbeddingGenerationResult>;
  };

  synchronizer: {
    synchronize(
      input:
        EmbeddingSynchronizerInput,
    ): Promise<EmbeddingSynchronizationResult>;
  };
}

/**
 * ERRORS
 */

export type EmbeddingOperation =
  | "prepare_text"
  | "generate"
  | "validate_vector"
  | "read_index_state"
  | "read_text_revision"
  | "read_text_changes"
  | "read_chunks"
  | "write_vectors";

export interface EmbeddingErrorOptions {
  operation: EmbeddingOperation;
  componentId: string;
  cause?: unknown;
}
