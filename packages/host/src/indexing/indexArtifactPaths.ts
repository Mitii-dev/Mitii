export const INDEX_DB_FILE = 'repository-index.sqlite';
export const LANCEDB_DIR = 'lancedb';
export const INDEX_RUNTIME_FILE = 'index-runtime.json';

export function safeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}
