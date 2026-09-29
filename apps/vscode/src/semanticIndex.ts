import {
  type EmbeddingBackend,
  type EmbeddingSource,
  defaultBundledModelsDirectory,
  normalizePositiveInteger,
  resolveEmbeddingSource,
  type SemanticIndexSettings,
} from '@mitii/host';
import type * as vscode from 'vscode';

export type { SemanticIndexSettings };
export {
  OpenAiCompatibleEmbeddingProvider,
  createLanceDbConnection,
  writeIndexRuntimeMetadata,
  readIndexRuntimeMetadata,
} from '@mitii/host';
export type { IndexRuntimeMetadata } from '@mitii/host';

export async function resolveVsCodeSemanticIndexSettings(
  vs: typeof vscode,
  secrets: vscode.SecretStorage,
): Promise<SemanticIndexSettings> {
  const cfg = vs.workspace.getConfiguration('mitii');
  const requested = cfg.get<boolean>('semanticIndex.enabled') ?? true;
  const baseUrl =
    cfg.get<string>('provider.baseUrl')?.trim() ||
    'http://localhost:11434/v1';
  const sourceConfigured = hasConfiguredValue(
    cfg.inspect<string>('semanticIndex.source'),
  );
  const backendConfigured = hasConfiguredValue(
    cfg.inspect<string>('semanticIndex.backend'),
  );
  const requestedSource = sourceConfigured
    ? parseEmbeddingSource(cfg.get<string>('semanticIndex.source'))
    : undefined;
  const requestedBackend = backendConfigured
    ? parseEmbeddingBackend(cfg.get<string>('semanticIndex.backend'))
    : undefined;
  const embeddingModelConfigured = hasConfiguredValue(
    cfg.inspect<string>('semanticIndex.model'),
  );
  const resolution = resolveEmbeddingSource({
    schemaVersion: 1,
    requestedEnabled: requested,
    source: requestedSource,
    backend: requestedBackend ?? (requestedSource ? undefined : 'auto'),
    baseUrl,
    embeddingModelConfigured,
  });
  const apiKey =
    (await secrets.get('mitii.provider.apiKey')) ??
    process.env.MITII_API_KEY ??
    process.env.OPENAI_API_KEY;

  if (resolution.status === 'disabled') {
    return {
      enabled: false,
      source: 'disabled',
      backend: 'disabled',
      baseUrl,
      model: cfg.get<string>('semanticIndex.model')?.trim() || '',
      dimensions: normalizePositiveInteger(
        cfg.get<number>('semanticIndex.dimensions'),
        384,
      ),
      normalized: cfg.get<boolean>('semanticIndex.normalized') ?? true,
      modelsDirectory: defaultBundledModelsDirectory(),
      ...(apiKey ? { apiKey } : {}),
    };
  }

  const model =
    resolution.source === 'bundled'
      ? resolution.model
      : cfg.get<string>('semanticIndex.model')?.trim() || resolution.model;
  const dimensions =
    resolution.source === 'bundled'
      ? resolution.dimensions
      : normalizePositiveInteger(
          cfg.get<number>('semanticIndex.dimensions'),
          resolution.dimensions,
        );

  return {
    enabled: true,
    source: resolution.source,
    backend: resolution.backend,
    baseUrl,
    model,
    dimensions,
    normalized: cfg.get<boolean>('semanticIndex.normalized') ?? true,
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

type ConfigurationInspection<T> = {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
};

function hasConfiguredValue<T>(
  inspect: ConfigurationInspection<T> | undefined,
): boolean {
  if (!inspect) return false;
  return [
    inspect.globalValue,
    inspect.workspaceValue,
    inspect.workspaceFolderValue,
    inspect.globalLanguageValue,
    inspect.workspaceLanguageValue,
    inspect.workspaceFolderLanguageValue,
  ].some((value) => value !== undefined);
}
