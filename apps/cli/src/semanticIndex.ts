import {
  normalizePositiveInteger,
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
  const providerConfigured =
    options.config.provider === 'openai-compatible' || Boolean(apiKey);
  return {
    enabled: !explicitlyDisabled && providerConfigured,
    baseUrl:
      options.env.MITII_BASE_URL ??
      options.config.baseUrl ??
      'https://api.openai.com/v1',
    model:
      options.env.MITII_EMBEDDING_MODEL ??
      options.config.embeddingModel ??
      'text-embedding-3-small',
    dimensions: normalizePositiveInteger(
      Number(options.env.MITII_EMBEDDING_DIMENSIONS) ||
        options.config.embeddingDimensions,
      1536,
    ),
    normalized: options.env.MITII_EMBEDDING_NORMALIZED !== '0',
    ...(apiKey ? { apiKey } : {}),
  };
}
