/** Bundled Ollama embedding model helpers. */



export const NOMIC_EMBED_MODEL = 'nomic-embed-text';

export const DEFAULT_OLLAMA_V1 = 'http://127.0.0.1:11434/v1';

export const OLLAMA_INSTALL_URL = 'https://ollama.com/download';

export type NomicInstallStatus =
  | 'checking'
  | 'ready'
  | 'missing'
  | 'downloading'
  | 'unreachable';

export function resolveOllamaEmbeddingBaseUrl(providerBaseUrl?: string): string {
  const trimmed = providerBaseUrl?.trim();
  if (trimmed && /ollama|11434/i.test(trimmed)) {
    return trimmed;
  }
  return DEFAULT_OLLAMA_V1;
}

export function isNomicEmbedInstalled(models: readonly string[]): boolean {
  const target = NOMIC_EMBED_MODEL;
  return models.some((id) => {
    const normalized = id.trim().toLowerCase().replace(/:latest$/, '');
    return (
      normalized === target ||
      normalized.startsWith(`${target}:`) ||
      target.startsWith(`${normalized}:`)
    );
  });
}
