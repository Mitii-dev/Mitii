import type {
  SourceAnalysis,
} from "../source-analysis/types";

/**
 * CORE VALUES
 */

export type ChunkingStatus =
  | "complete"
  | "partial"
  | "empty"
  | "cancelled"
  | "rejected"
  | "failed";

export type ChunkKind =
  | "code_symbol"
  | "code_region"
  | "markdown_section"
  | "text";

export type ChunkInputOverflowPolicy =
  | "truncate"
  | "reject";

/**
 * INPUT AND OPTIONS
 */

export interface ChunkingInput {
  sourceId: string;
  rootId: string;
  relativePath: string;
  content: string;

  language?: string;

  /**
   * Hash of the complete, unmodified source content.
   *
   * When omitted, ChunkingService calculates it through
   * ChunkContentHasher.
   */
  contentHash?: string;

  /**
   * Optional structural facts produced by source-analysis.
   *
   * CodeChunker consumes symbol ranges when they belong to this
   * source. Chunking never performs source parsing itself.
   */
  sourceAnalysis?: SourceAnalysis;

  abortSignal?: AbortSignal;
}

export interface ChunkingOptions {
  maximumInputCharacters?: number;
  inputOverflowPolicy?: ChunkInputOverflowPolicy;

  targetChunkCharacters?: number;
  maximumChunkCharacters?: number;
  minimumChunkCharacters?: number;
  overlapCharacters?: number;
  boundarySearchCharacters?: number;

  maximumChunks?: number;
  maximumTitleCharacters?: number;
}

export interface ResolvedChunkingOptions {
  maximumInputCharacters: number;
  inputOverflowPolicy: ChunkInputOverflowPolicy;

  targetChunkCharacters: number;
  maximumChunkCharacters: number;
  minimumChunkCharacters: number;
  overlapCharacters: number;
  boundarySearchCharacters: number;

  maximumChunks: number;
  maximumTitleCharacters: number;
}

/**
 * STRATEGY PORT
 */

export interface ChunkingStrategyContext {
  sourceId: string;
  rootId: string;
  relativePath: string;
  content: string;
  language?: string;
  sourceAnalysis?: SourceAnalysis;
  options: ResolvedChunkingOptions;
  abortSignal?: AbortSignal;
}

export interface RawChunkSpan {
  startOffset: number;
  endOffset: number;
  kind: ChunkKind;

  title?: string;
  symbolLocalId?: string;

  /**
   * Optional rewritten body (collapsed parent overview).
   * Offsets still refer to the original source span.
   */
  contentOverride?: string;
}

export interface ChunkingStrategyResult {
  spans: RawChunkSpan[];
  warnings: ChunkingWarning[];
}

export interface ChunkingStrategy {
  readonly id: string;
  readonly priority: number;

  supports(context: ChunkingStrategyContext): boolean;

  createSpans(
    context: ChunkingStrategyContext,
  ): Promise<ChunkingStrategyResult> | ChunkingStrategyResult;
}

export interface ChunkingStrategyResolution {
  strategies: readonly ChunkingStrategy[];
}

/**
 * HASHING AND TOKEN ESTIMATION PORTS
 */

export interface ChunkContentHasher {
  readonly id: string;
  hash(content: string): string;
}

export interface ChunkTokenEstimator {
  readonly id: string;
  estimate(content: string): number;
}

/**
 * NORMALIZATION
 */

export interface ChunkNormalizationInput {
  sourceId: string;
  rootId: string;
  relativePath: string;
  sourceContentHash: string;
  content: string;
  strategyId: string;
  spans: readonly RawChunkSpan[];
  options: ResolvedChunkingOptions;
  abortSignal?: AbortSignal;
}

export interface ChunkNormalizationResult {
  chunks: Chunk[];
  warnings: ChunkingWarning[];
  truncated: boolean;
  cancelled: boolean;
}

export interface ChunkIdInput {
  sourceId: string;
  rootId: string;
  relativePath: string;
  sourceContentHash: string;
  strategyId: string;
  kind: ChunkKind;
  startOffset: number;
  endOffset: number;
  contentHash: string;
}

/**
 * OUTPUT
 */

export interface Chunk {
  id: string;

  sourceId: string;
  rootId: string;
  relativePath: string;

  strategyId: string;
  ordinal: number;
  kind: ChunkKind;

  content: string;
  sourceContentHash: string;
  contentHash: string;
  tokenEstimate: number;

  /**
   * UTF-16 offsets into the processed source text.
   *
   * startOffset is inclusive and endOffset is exclusive.
   */
  startOffset: number;
  endOffset: number;

  /**
   * One-based inclusive line numbers.
   */
  startLine: number;
  endLine: number;

  title?: string;
  symbolLocalId?: string;
}

export type ChunkingWarningCode =
  | "input_truncated"
  | "input_rejected"
  | "source_analysis_mismatch"
  | "source_analysis_unusable"
  | "strategy_failed"
  | "strategy_returned_empty"
  | "invalid_span"
  | "duplicate_span_removed"
  | "chunks_truncated"
  | "collapsed_parent"
  | "cancelled";

export interface ChunkingWarning {
  code: ChunkingWarningCode;
  message: string;

  strategyId?: string;
  startOffset?: number;
  endOffset?: number;
}

export interface ChunkingStatistics {
  inputCharacters: number;
  processedCharacters: number;
  omittedCharacters: number;
  inputLines: number;

  emittedChunks: number;
  estimatedTokens: number;
}

export interface ChunkingResult {
  schemaVersion: 1;

  sourceId: string;
  rootId: string;
  relativePath: string;

  language?: string;
  sourceContentHash: string;
  strategyId?: string;

  status: ChunkingStatus;
  chunks: Chunk[];
  warnings: ChunkingWarning[];
  statistics: ChunkingStatistics;
}

/**
 * SERVICE AND FACTORY
 */

export interface ChunkingServiceDependencies {
  registry: ChunkingStrategyRegistryPort;
  normalizer: ChunkNormalizerPort;
  hasher: ChunkContentHasher;
}

export interface ChunkingStrategyRegistryPort {
  register(strategy: ChunkingStrategy): void;
  unregister(strategyId: string): boolean;
  freeze(): void;
  isFrozen(): boolean;
  list(): readonly ChunkingStrategy[];
  resolve(context: ChunkingStrategyContext): ChunkingStrategyResolution;
}

export interface ChunkNormalizerPort {
  normalize(input: ChunkNormalizationInput): ChunkNormalizationResult;
}

export interface ChunkingFactoryDependencies {
  hasher: ChunkContentHasher;
  tokenEstimator?: ChunkTokenEstimator;
  additionalStrategies?: readonly ChunkingStrategy[];
}

export interface ChunkingFactoryOptions {
  defaultOptions?: ChunkingOptions;
}

export interface ChunkingServicePort {
  chunk(
    input: ChunkingInput,
    options?: ChunkingOptions,
  ): Promise<ChunkingResult>;
}

