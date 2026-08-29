import { isOllamaBaseUrl } from '../../../config/providerPresets.js';
import {
  BUNDLED_EMBEDDING_SCHEMA_VERSION,
  EMBEDDING_SOURCE_REASON_CODES,
} from '../constants.js';
import {
  EmbeddingSourceResolutionInputSchema,
  EmbeddingSourceResolutionSchema,
  type EmbeddingSource,
  type EmbeddingSourceResolution,
  type EmbeddingSourceResolutionInput,
} from '../contracts.js';
import { BUNDLED_MINILM_PRESET, DEFAULT_EMBEDDING_SOURCE } from '../defaults.js';

const OLLAMA_PRESET = {
  model: 'nomic-embed-text',
  dimensions: 768,
} as const;

const OPENAI_COMPATIBLE_PRESET = {
  model: 'text-embedding-3-small',
  dimensions: 1536,
} as const;

const ENABLED_SOURCES = new Set<Exclude<EmbeddingSource, 'disabled'>>([
  'bundled',
  'ollama',
  'openai-compatible',
]);

function parseKnownSource(value: string | undefined): EmbeddingSource | undefined {
  const normalized = value?.trim();
  if (
    normalized === 'bundled' ||
    normalized === 'ollama' ||
    normalized === 'openai-compatible' ||
    normalized === 'disabled'
  ) {
    return normalized;
  }
  return undefined;
}

function enabledResolution(
  source: Exclude<EmbeddingSource, 'disabled'>,
  reasonCode: string,
): EmbeddingSourceResolution {
  if (source === 'bundled') {
    return EmbeddingSourceResolutionSchema.parse({
      schemaVersion: BUNDLED_EMBEDDING_SCHEMA_VERSION,
      status: 'enabled',
      source,
      backend: source,
      model: BUNDLED_MINILM_PRESET.model,
      dimensions: BUNDLED_MINILM_PRESET.dimensions,
      normalized: true,
      reasonCode,
    });
  }
  if (source === 'ollama') {
    return EmbeddingSourceResolutionSchema.parse({
      schemaVersion: BUNDLED_EMBEDDING_SCHEMA_VERSION,
      status: 'enabled',
      source,
      backend: source,
      model: OLLAMA_PRESET.model,
      dimensions: OLLAMA_PRESET.dimensions,
      normalized: true,
      reasonCode,
    });
  }
  return EmbeddingSourceResolutionSchema.parse({
    schemaVersion: BUNDLED_EMBEDDING_SCHEMA_VERSION,
    status: 'enabled',
    source,
    backend: source,
    model: OPENAI_COMPATIBLE_PRESET.model,
    dimensions: OPENAI_COMPATIBLE_PRESET.dimensions,
    normalized: true,
    reasonCode,
  });
}

function disabledResolution(reasonCode: string): EmbeddingSourceResolution {
  return EmbeddingSourceResolutionSchema.parse({
    schemaVersion: BUNDLED_EMBEDDING_SCHEMA_VERSION,
    status: 'disabled',
    source: 'disabled',
    backend: 'disabled',
    reasonCode,
  });
}

function resolveAuto(input: EmbeddingSourceResolutionInput): EmbeddingSourceResolution {
  if (input.embeddingModelConfigured && isOllamaBaseUrl(input.baseUrl)) {
    return enabledResolution(
      'ollama',
      EMBEDDING_SOURCE_REASON_CODES.auto_explicit_model_ollama,
    );
  }
  if (input.embeddingModelConfigured) {
    return enabledResolution(
      'openai-compatible',
      EMBEDDING_SOURCE_REASON_CODES.auto_explicit_model_openai,
    );
  }
  return enabledResolution(
    DEFAULT_EMBEDDING_SOURCE,
    EMBEDDING_SOURCE_REASON_CODES.default_bundled,
  );
}

/**
 * Chooses the embedding source independently of the chat-model provider.
 *
 * `source` wins when it is a known value. Legacy `backend` remains an alias;
 * `auto` with no embedding model now selects bundled MiniLM instead of
 * disabling vectors.
 */
export function resolveEmbeddingSource(
  raw: EmbeddingSourceResolutionInput,
): EmbeddingSourceResolution {
  const input = EmbeddingSourceResolutionInputSchema.parse(raw);
  if (!input.requestedEnabled) {
    return disabledResolution(EMBEDDING_SOURCE_REASON_CODES.requested_disabled);
  }

  const source = parseKnownSource(input.source);
  if (source === 'disabled') {
    return disabledResolution(EMBEDDING_SOURCE_REASON_CODES.source_disabled);
  }
  if (source && ENABLED_SOURCES.has(source)) {
    return enabledResolution(
      source,
      EMBEDDING_SOURCE_REASON_CODES.source_explicit,
    );
  }

  const backend = parseKnownSource(input.backend);
  if (backend === 'disabled') {
    return disabledResolution(EMBEDDING_SOURCE_REASON_CODES.source_disabled);
  }
  if (backend && ENABLED_SOURCES.has(backend)) {
    return enabledResolution(
      backend,
      EMBEDDING_SOURCE_REASON_CODES.backend_explicit,
    );
  }
  if (input.backend?.trim() === 'auto') {
    return resolveAuto(input);
  }

  return enabledResolution(
    DEFAULT_EMBEDDING_SOURCE,
    EMBEDDING_SOURCE_REASON_CODES.default_bundled,
  );
}

export function isEnabledEmbeddingSource(
  value: string,
): value is Exclude<EmbeddingSource, 'disabled'> {
  return ENABLED_SOURCES.has(value as Exclude<EmbeddingSource, 'disabled'>);
}
