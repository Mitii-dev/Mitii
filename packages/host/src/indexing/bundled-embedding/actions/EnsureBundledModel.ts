import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { BUNDLED_EMBEDDING_SCHEMA_VERSION, BUNDLED_MODEL_REASON_CODES } from '../constants.js';
import {
  BundledEmbeddingModelCatalogSchema,
  EnsureBundledModelResultSchema,
  type BundledEmbeddingModelCatalog,
  type EnsureBundledModelResult,
  type ModelAssetDownloader,
} from '../contracts.js';

export async function ensureBundledModel(options: {
  catalog: BundledEmbeddingModelCatalog;
  modelsDirectory: string;
  downloader: ModelAssetDownloader;
  abortSignal?: AbortSignal;
}): Promise<EnsureBundledModelResult> {
  const catalog = BundledEmbeddingModelCatalogSchema.parse(options.catalog);
  mkdirSync(options.modelsDirectory, { recursive: true });
  const modelPath = join(options.modelsDirectory, catalog.assets.model.fileName);
  const tokenizerPath = join(
    options.modelsDirectory,
    catalog.assets.tokenizer.fileName,
  );

  try {
    await options.downloader.ensure({
      url: catalog.assets.model.url,
      destinationPath: modelPath,
      sha256: catalog.assets.model.sha256,
      bytes: catalog.assets.model.bytes,
      minBytes: catalog.assets.model.minBytes,
      maxBytes: catalog.assets.model.maxBytes,
      abortSignal: options.abortSignal,
    });
    await options.downloader.ensure({
      url: catalog.assets.tokenizer.url,
      destinationPath: tokenizerPath,
      sha256: catalog.assets.tokenizer.sha256,
      bytes: catalog.assets.tokenizer.bytes,
      minBytes: catalog.assets.tokenizer.minBytes,
      maxBytes: catalog.assets.tokenizer.maxBytes,
      abortSignal: options.abortSignal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reasonCode = message.includes('checksum')
      ? BUNDLED_MODEL_REASON_CODES.checksum_mismatch
      : message.includes('size')
        ? BUNDLED_MODEL_REASON_CODES.size_mismatch
        : BUNDLED_MODEL_REASON_CODES.download_failed;
    return EnsureBundledModelResultSchema.parse({
      schemaVersion: BUNDLED_EMBEDDING_SCHEMA_VERSION,
      status: 'failed',
      reasonCode,
      message,
    });
  }

  return EnsureBundledModelResultSchema.parse({
    schemaVersion: BUNDLED_EMBEDDING_SCHEMA_VERSION,
    status: 'ready',
    assets: { modelPath, tokenizerPath },
    reasonCode: BUNDLED_MODEL_REASON_CODES.ready,
  });
}
