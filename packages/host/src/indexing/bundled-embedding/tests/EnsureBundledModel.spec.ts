import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ensureBundledModel } from '../actions/EnsureBundledModel.js';
import { BUNDLED_MINILM_CATALOG } from '../catalog.js';
import type { ModelAssetDownloader } from '../contracts.js';

describe('ensureBundledModel', () => {
  it('writes catalog assets through the downloader port', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mitii-minilm-'));
    const downloaded: string[] = [];
    const downloader: ModelAssetDownloader = {
      async ensure(input) {
        downloaded.push(input.destinationPath);
        writeFileSync(input.destinationPath, 'ok');
      },
    };

    const result = await ensureBundledModel({
      catalog: BUNDLED_MINILM_CATALOG,
      modelsDirectory: directory,
      downloader,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(readFileSync(result.assets.modelPath, 'utf8')).toBe('ok');
    expect(readFileSync(result.assets.tokenizerPath, 'utf8')).toBe('ok');
    expect(downloaded).toHaveLength(2);
  });

  it('maps checksum failures to a stable reason code', async () => {
    const result = await ensureBundledModel({
      catalog: BUNDLED_MINILM_CATALOG,
      modelsDirectory: mkdtempSync(join(tmpdir(), 'mitii-minilm-')),
      downloader: {
        async ensure() {
          throw new Error('Downloaded asset checksum did not match the catalog sha256.');
        },
      },
    });
    expect(result).toMatchObject({
      status: 'failed',
      reasonCode: 'checksum_mismatch',
    });
  });
});
