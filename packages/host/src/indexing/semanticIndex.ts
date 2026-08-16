import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  EmbeddingProfile,
  EmbeddingProvider,
  LanceDbConnectionPort,
  WorkspaceIndexingPipelineResult,
} from '@mitii/v8';

import {
  BUNDLED_MINILM_PRESET,
  createBundledMiniLmEmbeddingProvider,
  defaultBundledModelsDirectory,
  resolveEmbeddingSource,
  type EmbeddingSource,
  type ResolveBundledEmbeddingProviderOptions,
} from './bundled-embedding/index.js';

export const DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL =
  'text-embedding-3-small';
export const DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
export const DEFAULT_OLLAMA_EMBEDDING_DIMENSIONS = 768;

export type EmbeddingBackend =
  | 'openai-compatible'
  | 'ollama'
  | 'bundled'
  | 'disabled';

export type { EmbeddingSource };

export interface EmbeddingPreset {
  backend: Exclude<EmbeddingBackend, 'disabled'>;
  model: string;
  dimensions: number;
  baseUrlHint: string;
  normalized: boolean;
}

export const EMBEDDING_PRESETS = {
  'openai-text-embedding-3-small': {
    backend: 'openai-compatible',
    model: DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL,
    dimensions: DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS,
    baseUrlHint: 'https://api.openai.com/v1',
    normalized: true,
  },
  'ollama-nomic-embed-text': {
    backend: 'ollama',
    model: DEFAULT_OLLAMA_EMBEDDING_MODEL,
    dimensions: DEFAULT_OLLAMA_EMBEDDING_DIMENSIONS,
    baseUrlHint: 'http://localhost:11434/v1',
    normalized: true,
  },
  'ollama-jina-code': {
    backend: 'ollama',
    model: 'jina/jina-embeddings-v2-base-code',
    dimensions: 768,
    baseUrlHint: 'http://localhost:11434/v1',
    normalized: true,
  },
  'bundled-minilm-l6-v2': {
    backend: 'bundled',
    model: BUNDLED_MINILM_PRESET.model,
    dimensions: BUNDLED_MINILM_PRESET.dimensions,
    baseUrlHint: '',
    normalized: true,
  },
} as const satisfies Record<string, EmbeddingPreset>;

export type EmbeddingPresetId = keyof typeof EMBEDDING_PRESETS;

export interface SemanticIndexSettings {
  enabled: boolean;
  backend?: EmbeddingBackend;
  source?: EmbeddingSource;
  baseUrl: string;
  model: string;
  dimensions: number;
  normalized: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  modelsDirectory?: string;
}

export interface SemanticIndexEnablementOptions {
  requested: boolean;
  providerType: string;
  baseUrl: string;
  embeddingModelConfigured: boolean;
  backend?: EmbeddingBackend | 'auto';
  source?: EmbeddingSource;
}

export type EmbeddingProbeResult =
  | {
      ok: true;
      dimensions: number;
    }
  | {
      ok: false;
      reason: string;
    };

export interface IndexRuntimeMetadata {
  schemaVersion: 1;
  workspaceId: string;
  sqlitePath: string;
  lanceDbPath: string;
  embeddingProfile?: EmbeddingProfile;
  vectorRuntimeKey?: string;
  snapshotFingerprint?: string;
  fileCount?: number;
  truncated?: boolean;
  lastIndexingResult?: WorkspaceIndexingPipelineResult;
  catalogRevisionByRoot?: Record<string, string>;
  graphRevisionByRoot?: Record<string, string>;
  mapRevisionByRoot?: Record<string, string>;
  graphArtifactPaths?: Record<string, string>;
  mapArtifactPaths?: Record<string, string>;
  textIndexSchemaVersion?: number;
  textPipelineVersion?: string;
  graphBuilderVersion?: string;
  treeSitterRuntime?: 'ready' | 'unavailable';
  generatedAt: string;
}

export function shouldEnableSemanticIndex(
  options: SemanticIndexEnablementOptions,
): boolean {
  return (
    resolveEmbeddingSource({
      schemaVersion: 1,
      requestedEnabled: options.requested,
      source: options.source,
      backend: options.backend,
      baseUrl: options.baseUrl,
      embeddingModelConfigured: options.embeddingModelConfigured,
    }).status === 'enabled'
  );
}

export function resolveDefaultEmbeddingPreset(options: {
  baseUrl: string;
  backend?: EmbeddingBackend | 'auto';
  source?: EmbeddingSource;
  embeddingModelConfigured?: boolean;
}): EmbeddingPreset {
  const resolution = resolveEmbeddingSource({
    schemaVersion: 1,
    requestedEnabled: true,
    source: options.source,
    backend: options.backend,
    baseUrl: options.baseUrl,
    embeddingModelConfigured: options.embeddingModelConfigured === true,
  });
  if (resolution.status === 'disabled' || resolution.source === 'bundled') {
    return EMBEDDING_PRESETS['bundled-minilm-l6-v2'];
  }
  if (resolution.source === 'ollama') {
    return EMBEDDING_PRESETS['ollama-nomic-embed-text'];
  }
  return EMBEDDING_PRESETS['openai-text-embedding-3-small'];
}

export function normalizeEmbeddingRequestBaseUrl(
  baseUrl: string,
  backend: EmbeddingBackend = 'openai-compatible',
): string {
  const root = baseUrl.trim().replace(/\/+$/, '');
  if (backend === 'ollama' && !/\/v1$/i.test(root)) {
    return `${root}/v1`;
  }
  return root;
}

export function alignSemanticSettingsWithPersistedProfile(
  settings: SemanticIndexSettings,
  profile: EmbeddingProfile,
): SemanticIndexSettings | undefined {
  const backend = settings.backend ?? settings.source ?? 'openai-compatible';
  if (
    backend !== profile.providerId ||
    settings.model !== profile.modelId ||
    settings.normalized !== profile.normalized
  ) {
    return undefined;
  }
  if (settings.dimensions === profile.dimensions) {
    return settings;
  }
  return {
    ...settings,
    dimensions: profile.dimensions,
  };
}

export function createHostEmbeddingProvider(
  settings: SemanticIndexSettings,
): EmbeddingProvider {
  const backend = settings.backend ?? settings.source ?? 'openai-compatible';
  if (!settings.enabled || backend === 'disabled') {
    throw new Error('Semantic index is disabled.');
  }
  if (backend === 'bundled') {
    throw new Error(
      'Bundled MiniLM embeddings require resolveHostEmbeddingProvider().',
    );
  }
  return new OpenAiCompatibleEmbeddingProvider({
    ...settings,
    backend,
  });
}

export async function resolveHostEmbeddingProvider(
  settings: SemanticIndexSettings,
  options?: ResolveBundledEmbeddingProviderOptions,
): Promise<EmbeddingProvider> {
  const backend = settings.backend ?? settings.source ?? 'openai-compatible';
  if (!settings.enabled || backend === 'disabled') {
    throw new Error('Semantic index is disabled.');
  }
  if (backend === 'bundled') {
    return createBundledMiniLmEmbeddingProvider({
      ...options,
      modelsDirectory:
        options?.modelsDirectory ??
        settings.modelsDirectory ??
        defaultBundledModelsDirectory(),
    });
  }
  return createHostEmbeddingProvider(settings);
}

export async function probeEmbeddingProvider(
  settings: SemanticIndexSettings,
  context?: { abortSignal?: AbortSignal },
): Promise<EmbeddingProbeResult> {
  try {
    const backend = settings.backend ?? settings.source ?? 'openai-compatible';
    const provider =
      backend === 'bundled'
        ? await resolveHostEmbeddingProvider(settings)
        : new OpenAiCompatibleEmbeddingProvider(
            {
              ...settings,
              enabled: true,
              backend,
            },
            {
              acceptDiscoveredDimensions: backend === 'ollama',
            },
          );
    const [vector] = await provider.embed(['mitii embedding probe'], {
      abortSignal: context?.abortSignal,
    });
    if (!vector?.length) {
      return {
        ok: false,
        reason: 'Embedding provider returned an empty vector.',
      };
    }
    return {
      ok: true,
      dimensions: vector.length,
    };
  } catch (error) {
    return {
      ok: false,
      reason: formatEmbeddingProbeFailure(settings, error),
    };
  }
}

function formatEmbeddingProbeFailure(
  settings: SemanticIndexSettings,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  if ((settings.backend ?? settings.source ?? 'openai-compatible') === 'ollama') {
    return `${message}. Ensure Ollama is running and run "ollama pull ${settings.model}".`;
  }
  if ((settings.backend ?? settings.source) === 'bundled') {
    return `${message}. Bundled MiniLM downloads once into ${
      settings.modelsDirectory ?? defaultBundledModelsDirectory()
    }.`;
  }
  return message;
}

export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly profile: EmbeddingProfile;

  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly settings: SemanticIndexSettings,
    private readonly options: {
      acceptDiscoveredDimensions?: boolean;
    } = {},
  ) {
    this.fetchImpl = settings.fetchImpl ?? fetch;
    const backend = settings.backend ?? settings.source ?? 'openai-compatible';
    this.profile = {
      id: [
        backend,
        settings.model,
        settings.dimensions,
        settings.normalized ? 'normalized' : 'raw',
      ].join(':'),
      providerId: backend,
      modelId: settings.model,
      dimensions: settings.dimensions,
      normalized: settings.normalized,
    };
  }

  async embed(
    texts: readonly string[],
    context?: { abortSignal?: AbortSignal },
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = {
      model: this.settings.model,
      input: texts,
    };
    if (
      (this.settings.backend ?? this.settings.source ?? 'openai-compatible') !==
        'ollama' &&
      this.settings.dimensions > 0
    ) {
      body.dimensions = this.settings.dimensions;
    }
    const response = await this.fetchImpl(this.embeddingsUrl(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: context?.abortSignal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Embedding provider failed (${response.status}): ${detail || response.statusText}`,
      );
    }
    const payload = (await response.json()) as unknown;
    const rows = extractEmbeddingVectors(payload, texts.length);
    return rows.map((row) => this.parseVector(row));
  }

  private embeddingsUrl(): string {
    return `${normalizeEmbeddingRequestBaseUrl(
      this.settings.baseUrl,
      this.settings.backend ?? this.settings.source ?? 'openai-compatible',
    )}/embeddings`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.settings.apiKey
        ? { Authorization: `Bearer ${this.settings.apiKey}` }
        : {}),
    };
  }

  private parseVector(value: unknown): number[] {
    if (!Array.isArray(value)) {
      throw new Error('Embedding provider returned a non-array vector.');
    }
    const vector = value.map((item) => Number(item));
    if (
      vector.length !== this.settings.dimensions ||
      vector.some((item) => !Number.isFinite(item))
    ) {
      if (
        this.options.acceptDiscoveredDimensions &&
        vector.length > 0 &&
        vector.every((item) => Number.isFinite(item))
      ) {
        return vector;
      }
      throw new Error(
        `Embedding vector dimensions do not match profile ${this.profile.id}.`,
      );
    }
    return vector;
  }
}

function extractEmbeddingVectors(
  payload: unknown,
  expectedCount: number,
): unknown[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Embedding provider returned a non-object payload.');
  }
  const record = payload as {
    data?: Array<{ index?: number; embedding?: unknown }>;
    embeddings?: unknown;
    embedding?: unknown;
  };
  if (Array.isArray(record.data)) {
    if (record.data.length !== expectedCount) {
      throw new Error(
        `Embedding provider returned ${record.data.length} vectors for ${expectedCount} inputs.`,
      );
    }
    return record.data
      .slice()
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((row) => row.embedding);
  }
  if (Array.isArray(record.embeddings)) {
    if (record.embeddings.length !== expectedCount) {
      throw new Error(
        `Embedding provider returned ${record.embeddings.length} vectors for ${expectedCount} inputs.`,
      );
    }
    return record.embeddings;
  }
  if (expectedCount === 1 && Array.isArray(record.embedding)) {
    return [record.embedding];
  }
  throw new Error(
    `Embedding provider returned no vectors for ${expectedCount} inputs.`,
  );
}

export async function createLanceDbConnection(
  path: string,
): Promise<LanceDbConnectionPort> {
  mkdirSync(path, { recursive: true });
  const mod = (await import('@lancedb/lancedb')) as {
    connect?: (uri: string) => Promise<LanceDbConnectionPort>;
  };
  if (typeof mod.connect !== 'function') {
    throw new Error('@lancedb/lancedb does not expose connect().');
  }
  return mod.connect(path);
}

export function writeIndexRuntimeMetadata(
  path: string,
  metadata: IndexRuntimeMetadata,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

export function readIndexRuntimeMetadata(
  path: string,
): IndexRuntimeMetadata | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as IndexRuntimeMetadata;
    if (
      parsed?.schemaVersion !== 1 ||
      !parsed.workspaceId ||
      !parsed.sqlitePath ||
      !parsed.lanceDbPath
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return Math.floor(value);
  }
  return fallback;
}
