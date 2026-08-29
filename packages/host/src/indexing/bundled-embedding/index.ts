import { readFileSync } from 'node:fs';

import type { EmbeddingProfile, EmbeddingProvider } from '@mitii/v8';

import { ensureBundledModel } from './actions/EnsureBundledModel.js';
import { BertWordPieceTokenizer } from './adapters/BertWordPieceTokenizer.js';
import { HttpModelAssetDownloader } from './adapters/HttpModelAssetDownloader.js';
import { MiniLmOnnxEmbeddingProvider } from './adapters/MiniLmOnnxEmbeddingProvider.js';
import { HostOnnxRuntimeSessionFactory } from './adapters/OnnxRuntimeSessionFactory.js';
import { BUNDLED_MINILM_CATALOG } from './catalog.js';
import { BUNDLED_MINILM_PROVIDER_ID } from './constants.js';
import type {
  EmbeddingSourceResolution,
  ModelAssetDownloader,
  OnnxRuntimeSessionFactory,
  TextTokenizer,
} from './contracts.js';
import { defaultBundledModelsDirectory } from './defaults.js';

export { BUNDLED_MINILM_CATALOG } from './catalog.js';
export {
  BUNDLED_MINILM_DIMENSIONS,
  BUNDLED_MINILM_ID,
  BUNDLED_MINILM_MODEL_ID,
  BUNDLED_MINILM_PROVIDER_ID,
  EMBEDDING_SOURCE_REASON_CODES,
  ONNX_NATIVE_TARGETS,
} from './constants.js';
export {
  BUNDLED_MINILM_PRESET,
  DEFAULT_EMBEDDING_SOURCE,
  defaultBundledModelsDirectory,
} from './defaults.js';
export {
  EmbeddingSourceResolutionInputSchema,
  EmbeddingSourceResolutionSchema,
  EmbeddingSourceSchema,
  type EmbeddingSource,
  type EmbeddingSourceResolution,
  type EmbeddingSourceResolutionInput,
} from './contracts.js';
export {
  isEnabledEmbeddingSource,
  resolveEmbeddingSource,
} from './actions/ResolveEmbeddingSource.js';

export interface ResolveBundledEmbeddingProviderOptions {
  modelsDirectory?: string;
  downloader?: ModelAssetDownloader;
  sessionFactory?: OnnxRuntimeSessionFactory;
  tokenizer?: TextTokenizer;
  abortSignal?: AbortSignal;
}

const providerCache = new Map<string, Promise<EmbeddingProvider>>();

export function resetBundledEmbeddingProviderCache(): void {
  providerCache.clear();
}

export function bundledEmbeddingProfile(): EmbeddingProfile {
  return {
    id: [
      BUNDLED_MINILM_PROVIDER_ID,
      BUNDLED_MINILM_CATALOG.modelId,
      BUNDLED_MINILM_CATALOG.dimensions,
      BUNDLED_MINILM_CATALOG.normalized ? 'normalized' : 'raw',
    ].join(':'),
    providerId: BUNDLED_MINILM_PROVIDER_ID,
    modelId: BUNDLED_MINILM_CATALOG.modelId,
    dimensions: BUNDLED_MINILM_CATALOG.dimensions,
    normalized: BUNDLED_MINILM_CATALOG.normalized,
  };
}

export async function createBundledMiniLmEmbeddingProvider(
  options: ResolveBundledEmbeddingProviderOptions = {},
): Promise<EmbeddingProvider> {
  const modelsDirectory =
    options.modelsDirectory ?? defaultBundledModelsDirectory();
  const cacheKey = modelsDirectory;
  const existing = providerCache.get(cacheKey);
  if (existing && !options.tokenizer && !options.sessionFactory) {
    return existing;
  }

  const pending = (async () => {
    const ensured = await ensureBundledModel({
      catalog: BUNDLED_MINILM_CATALOG,
      modelsDirectory,
      downloader: options.downloader ?? new HttpModelAssetDownloader(),
      abortSignal: options.abortSignal,
    });
    if (ensured.status !== 'ready') {
      throw new Error(
        `Bundled MiniLM model is unavailable (${ensured.reasonCode}): ${ensured.message}`,
      );
    }
    const tokenizer =
      options.tokenizer ??
      BertWordPieceTokenizer.fromTokenizerJson(
        readFileSync(ensured.assets.tokenizerPath, 'utf8'),
      );
    const factory = options.sessionFactory ?? new HostOnnxRuntimeSessionFactory();
    const runtime = await factory.create({
      modelPath: ensured.assets.modelPath,
      abortSignal: options.abortSignal,
    });
    return new MiniLmOnnxEmbeddingProvider(
      runtime,
      tokenizer,
      bundledEmbeddingProfile(),
      {
        maxSequenceLength: BUNDLED_MINILM_CATALOG.maxSequenceLength,
        hiddenSize: BUNDLED_MINILM_CATALOG.hiddenSize,
      },
    );
  })();

  if (!options.tokenizer && !options.sessionFactory) {
    providerCache.set(cacheKey, pending);
    try {
      return await pending;
    } catch (error) {
      providerCache.delete(cacheKey);
      throw error;
    }
  }
  return pending;
}

export function describeEmbeddingSource(
  resolution: EmbeddingSourceResolution,
): string {
  if (resolution.status === 'disabled') {
    return `Embedding source disabled (${resolution.reasonCode}).`;
  }
  return `Embedding source ${resolution.source} (${resolution.model}, ${resolution.dimensions}d, ${resolution.reasonCode}).`;
}
