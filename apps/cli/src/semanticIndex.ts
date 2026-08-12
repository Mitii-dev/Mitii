import {
  type EmbeddingBackend,
  normalizePositiveInteger,
  resolveDefaultEmbeddingPreset,
  shouldEnableSemanticIndex,
  type SemanticIndexSettings,
} from '@mitii/host';

import type { MitiiHostConfig } from './config.js';

export type { SemanticIndexSettings };
export {
  OpenAiCompatibleEmbeddingProvider,
  createLanceDbConnection,
  writeIndexRuntimeMetadata,
  readIndexRuntimeMetadata,
} from '@mitii/host';
export type { IndexRuntimeMetadata } from '@mitii/host';

export function resolveCliSemanticIndexSettings(options: {
  env: NodeJS.ProcessEnv;
  config: MitiiHostConfig;
}): SemanticIndexSettings {
  const apiKey = options.env.MITII_API_KEY ?? options.env.OPENAI_API_KEY;
  const explicitlyDisabled = options.env.MITII_SEMANTIC_INDEX === '0';
  const baseUrl =
    options.env.MITII_BASE_URL ??
    options.config.baseUrl ??
    'https://api.openai.com/v1';
  const requestedBackend = parseEmbeddingBackend(
    options.env.MITII_EMBEDDING_BACKEND ??
      options.config.embeddingBackend ??
      'auto',
  );
  const preset = resolveDefaultEmbeddingPreset({
    baseUrl,
    backend: requestedBackend,
  });
  const backend: EmbeddingBackend =
    requestedBackend === 'auto' ? preset.backend : requestedBackend;
  const embeddingModel =
    options.env.MITII_EMBEDDING_MODEL ??
    options.config.embeddingModel ??
    preset.model;
  const embeddingModelConfigured = Boolean(
    options.env.MITII_EMBEDDING_MODEL?.trim() ||
      options.config.embeddingModel?.trim(),
  );
  const providerConfigured =
    options.config.provider === 'openai-compatible' || Boolean(apiKey);
  return {
    enabled: shouldEnableSemanticIndex({
      requested: !explicitlyDisabled && providerConfigured,
      providerType: providerConfigured ? 'openai-compatible' : 'echo',
      baseUrl,
      embeddingModelConfigured,
      backend,
    }),
    backend,
    baseUrl,
    model: embeddingModel,
    dimensions: normalizePositiveInteger(
      Number(options.env.MITII_EMBEDDING_DIMENSIONS) ||
        options.config.embeddingDimensions,
      preset.dimensions,
    ),
    normalized: options.env.MITII_EMBEDDING_NORMALIZED !== '0',
    ...(apiKey ? { apiKey } : {}),
  };
}

function parseEmbeddingBackend(
  value: string | undefined,
): EmbeddingBackend | 'auto' {
  const normalized = value?.trim();
  if (
    normalized === 'auto' ||
    normalized === 'openai-compatible' ||
    normalized === 'ollama' ||
    normalized === 'disabled'
  ) {
    return normalized;
  }
  return 'auto';
}
