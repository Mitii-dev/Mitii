import {
  normalizePositiveInteger,
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
  const enabled = cfg.get<boolean>('semanticIndex.enabled') ?? true;
  const apiKey =
    (await secrets.get('mitii.provider.apiKey')) ??
    process.env.MITII_API_KEY ??
    process.env.OPENAI_API_KEY;

  return {
    enabled: enabled && providerType === 'openai-compatible',
    baseUrl:
      cfg.get<string>('provider.baseUrl')?.trim() ||
      'http://localhost:11434/v1',
    model:
      cfg.get<string>('semanticIndex.model')?.trim() ||
      'text-embedding-3-small',
    dimensions: normalizePositiveInteger(
      cfg.get<number>('semanticIndex.dimensions'),
      1536,
    ),
    normalized: cfg.get<boolean>('semanticIndex.normalized') ?? true,
    ...(apiKey ? { apiKey } : {}),
  };
}
