import {
  DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS,
  DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL,
  normalizePositiveInteger,
  shouldEnableSemanticIndex,
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
  const providerType = cfg.get<string>('provider.type') ?? 'echo';
  const requested = cfg.get<boolean>('semanticIndex.enabled') ?? true;
  const baseUrl =
    cfg.get<string>('provider.baseUrl')?.trim() ||
    'http://localhost:11434/v1';
  const embeddingModelConfigured = hasConfiguredValue(
    cfg.inspect<string>('semanticIndex.model'),
  );
  const apiKey =
    (await secrets.get('mitii.provider.apiKey')) ??
    process.env.MITII_API_KEY ??
    process.env.OPENAI_API_KEY;

  return {
    enabled: shouldEnableSemanticIndex({
      requested,
      providerType,
      baseUrl,
      embeddingModelConfigured,
    }),
    baseUrl,
    model:
      cfg.get<string>('semanticIndex.model')?.trim() ||
      DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL,
    dimensions: normalizePositiveInteger(
      cfg.get<number>('semanticIndex.dimensions'),
      DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS,
    ),
    normalized: cfg.get<boolean>('semanticIndex.normalized') ?? true,
    ...(apiKey ? { apiKey } : {}),
  };
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
