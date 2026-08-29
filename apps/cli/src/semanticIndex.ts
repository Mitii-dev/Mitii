import {
  type EmbeddingBackend,
  type EmbeddingSource,
  defaultBundledModelsDirectory,
  normalizePositiveInteger,
  resolveEmbeddingSource,
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
  const requestedSource = parseEmbeddingSource(
    options.env.MITII_EMBEDDING_SOURCE ?? options.config.embeddingSource,
  );
  const requestedBackend = parseEmbeddingBackend(
    options.env.MITII_EMBEDDING_BACKEND ?? options.config.embeddingBackend,
  );
  const embeddingModelConfigured = Boolean(
    options.env.MITII_EMBEDDING_MODEL?.trim() ||
      options.config.embeddingModel?.trim(),
  );
  const resolution = resolveEmbeddingSource({
    schemaVersion: 1,
    requestedEnabled: !explicitlyDisabled,
    source: requestedSource,
    backend: requestedBackend ?? (requestedSource ? undefined : 'auto'),
    baseUrl,
    embeddingModelConfigured,
  });

  if (resolution.status === 'disabled') {
    return {
      enabled: false,
      source: 'disabled',
      backend: 'disabled',
      baseUrl,
      model:
        options.env.MITII_EMBEDDING_MODEL ??
        options.config.embeddingModel ??
        '',
      dimensions: normalizePositiveInteger(
        Number(options.env.MITII_EMBEDDING_DIMENSIONS) ||
          options.config.embeddingDimensions,
        384,
      ),
      normalized: options.env.MITII_EMBEDDING_NORMALIZED !== '0',
      modelsDirectory: defaultBundledModelsDirectory(),
      ...(apiKey ? { apiKey } : {}),
    };
  }

  const model =
    resolution.source === 'bundled'
      ? resolution.model
      : options.env.MITII_EMBEDDING_MODEL ??
        options.config.embeddingModel ??
        resolution.model;
  const dimensions =
    resolution.source === 'bundled'
      ? resolution.dimensions
      : normalizePositiveInteger(
          Number(options.env.MITII_EMBEDDING_DIMENSIONS) ||
            options.config.embeddingDimensions,
          resolution.dimensions,
        );

  return {
    enabled: true,
    source: resolution.source,
    backend: resolution.backend,
    baseUrl,
    model,
    dimensions,
    normalized: options.env.MITII_EMBEDDING_NORMALIZED !== '0',
    modelsDirectory: defaultBundledModelsDirectory(),
    ...(apiKey ? { apiKey } : {}),
  };
}

function parseEmbeddingSource(
  value: string | undefined,
): EmbeddingSource | undefined {
  const normalized = value?.trim();
  if (
    normalized === 'bundled' ||
    normalized === 'openai-compatible' ||
    normalized === 'ollama' ||
    normalized === 'disabled'
  ) {
    return normalized;
  }
  return undefined;
}

function parseEmbeddingBackend(
  value: string | undefined,
): EmbeddingBackend | 'auto' | undefined {
  const normalized = value?.trim();
  if (
    normalized === 'auto' ||
    normalized === 'bundled' ||
    normalized === 'openai-compatible' ||
    normalized === 'ollama' ||
    normalized === 'disabled'
  ) {
    return normalized;
  }
  return undefined;
}
