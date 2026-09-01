import { z } from 'zod';

import { BUNDLED_EMBEDDING_SCHEMA_VERSION } from './constants.js';

export const EmbeddingSourceSchema = z.enum([
  'bundled',
  'ollama',
  'openai-compatible',
  'disabled',
]);

export type EmbeddingSource = z.infer<typeof EmbeddingSourceSchema>;

export const OnnxExecutionKindSchema = z.enum(['native', 'wasm']);

export type OnnxExecutionKind = z.infer<typeof OnnxExecutionKindSchema>;

export const BundledModelAssetSchema = z.object({
  fileName: z.string().min(1),
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  bytes: z.number().int().positive().optional(),
  minBytes: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
});

export type BundledModelAsset = z.infer<typeof BundledModelAssetSchema>;

export const BundledEmbeddingModelCatalogSchema = z.object({
  schemaVersion: z.literal(BUNDLED_EMBEDDING_SCHEMA_VERSION),
  id: z.string().min(1),
  providerId: z.literal('bundled'),
  modelId: z.string().min(1),
  dimensions: z.number().int().positive(),
  hiddenSize: z.number().int().positive(),
  maxSequenceLength: z.number().int().positive(),
  normalized: z.literal(true),
  pooling: z.literal('mean'),
  assets: z.object({
    model: BundledModelAssetSchema,
    tokenizer: BundledModelAssetSchema,
  }),
});

export type BundledEmbeddingModelCatalog = z.infer<
  typeof BundledEmbeddingModelCatalogSchema
>;

export const EmbeddingSourceResolutionInputSchema = z.object({
  schemaVersion: z.literal(BUNDLED_EMBEDDING_SCHEMA_VERSION),
  requestedEnabled: z.boolean(),
  source: z.string().optional(),
  backend: z.string().optional(),
  baseUrl: z.string(),
  embeddingModelConfigured: z.boolean(),
});

export type EmbeddingSourceResolutionInput = z.infer<
  typeof EmbeddingSourceResolutionInputSchema
>;

export const EmbeddingSourceResolutionSchema = z.discriminatedUnion('status', [
  z.object({
    schemaVersion: z.literal(BUNDLED_EMBEDDING_SCHEMA_VERSION),
    status: z.literal('enabled'),
    source: z.enum(['bundled', 'ollama', 'openai-compatible']),
    backend: z.enum(['bundled', 'ollama', 'openai-compatible']),
    model: z.string().min(1),
    dimensions: z.number().int().positive(),
    normalized: z.boolean(),
    reasonCode: z.string().min(1),
  }),
  z.object({
    schemaVersion: z.literal(BUNDLED_EMBEDDING_SCHEMA_VERSION),
    status: z.literal('disabled'),
    source: z.literal('disabled'),
    backend: z.literal('disabled'),
    reasonCode: z.string().min(1),
  }),
]);

export type EmbeddingSourceResolution = z.infer<
  typeof EmbeddingSourceResolutionSchema
>;

export const OnnxNativeTargetSchema = z.object({
  platform: z.string().min(1),
  arch: z.string().min(1),
});

export type OnnxNativeTarget = z.infer<typeof OnnxNativeTargetSchema>;

export const OnnxExecutionProviderResolutionSchema = z.discriminatedUnion(
  'status',
  [
    z.object({
      schemaVersion: z.literal(BUNDLED_EMBEDDING_SCHEMA_VERSION),
      status: z.literal('ready'),
      kind: OnnxExecutionKindSchema,
      packageId: z.string().min(1),
      platform: z.string().min(1),
      arch: z.string().min(1),
      reasonCode: z.string().min(1),
    }),
    z.object({
      schemaVersion: z.literal(BUNDLED_EMBEDDING_SCHEMA_VERSION),
      status: z.literal('unavailable'),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ],
);

export type OnnxExecutionProviderResolution = z.infer<
  typeof OnnxExecutionProviderResolutionSchema
>;

export const BundledModelAssetsSchema = z.object({
  modelPath: z.string().min(1),
  tokenizerPath: z.string().min(1),
});

export type BundledModelAssets = z.infer<typeof BundledModelAssetsSchema>;

export const EnsureBundledModelResultSchema = z.discriminatedUnion('status', [
  z.object({
    schemaVersion: z.literal(BUNDLED_EMBEDDING_SCHEMA_VERSION),
    status: z.literal('ready'),
    assets: BundledModelAssetsSchema,
    reasonCode: z.literal('ready'),
  }),
  z.object({
    schemaVersion: z.literal(BUNDLED_EMBEDDING_SCHEMA_VERSION),
    status: z.literal('failed'),
    reasonCode: z.string().min(1),
    message: z.string().min(1),
  }),
]);

export type EnsureBundledModelResult = z.infer<
  typeof EnsureBundledModelResultSchema
>;

export interface TokenizedEmbeddingBatch {
  inputIds: number[][];
  attentionMask: number[][];
  tokenTypeIds: number[][];
  sequenceLength: number;
}

export interface TextTokenizer {
  encodeBatch(
    texts: readonly string[],
    options?: { maxLength?: number },
  ): TokenizedEmbeddingBatch;
}

export interface OnnxTensorLike {
  data: ArrayLike<number> | Float32Array;
  dims: readonly number[];
}

export interface OnnxInferenceSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(
    feeds: Record<string, unknown>,
  ): Promise<Record<string, OnnxTensorLike>>;
  /** Release native/WASM session resources before process exit when available. */
  release?(): Promise<void>;
}

export interface CreateOnnxSessionInput {
  modelPath: string;
  preferredKind?: OnnxExecutionKind;
  abortSignal?: AbortSignal;
}

export interface CreatedOnnxSession {
  session: OnnxInferenceSession;
  resolution: Extract<OnnxExecutionProviderResolution, { status: 'ready' }>;
  createInt64Tensor(values: number[], dims: readonly number[]): unknown;
}

export interface OnnxRuntimeSessionFactory {
  create(input: CreateOnnxSessionInput): Promise<CreatedOnnxSession>;
}

export interface ModelAssetDownloader {
  ensure(input: {
    url: string;
    destinationPath: string;
    sha256?: string;
    bytes?: number;
    minBytes?: number;
    maxBytes?: number;
    abortSignal?: AbortSignal;
  }): Promise<void>;
}
