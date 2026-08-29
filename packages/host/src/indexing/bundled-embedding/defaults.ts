import { homedir } from 'node:os';
import { join } from 'node:path';

import { BUNDLED_MINILM_CATALOG } from './catalog.js';
import { BUNDLED_MINILM_ID } from './constants.js';

export const DEFAULT_EMBEDDING_SOURCE = 'bundled' as const;

export const DEFAULT_BUNDLED_MODEL_DOWNLOAD_TIMEOUT_MS = 120_000;

export function defaultBundledModelsDirectory(
  rootDirectory: string = join(homedir(), '.mitii', 'models'),
): string {
  return join(rootDirectory, BUNDLED_MINILM_ID);
}

export const BUNDLED_MINILM_PRESET = {
  backend: 'bundled' as const,
  model: BUNDLED_MINILM_CATALOG.modelId,
  dimensions: BUNDLED_MINILM_CATALOG.dimensions,
  baseUrlHint: '',
  normalized: true,
};
