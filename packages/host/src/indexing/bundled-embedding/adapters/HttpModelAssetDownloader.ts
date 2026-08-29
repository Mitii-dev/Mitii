import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { DEFAULT_BUNDLED_MODEL_DOWNLOAD_TIMEOUT_MS } from '../defaults.js';
import type { ModelAssetDownloader } from '../contracts.js';

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertSize(options: {
  bytes: number;
  expected?: number;
  minBytes?: number;
  maxBytes?: number;
}): void {
  if (typeof options.expected === 'number' && options.bytes !== options.expected) {
    throw new Error(
      `Downloaded asset size ${options.bytes} did not match expected ${options.expected}.`,
    );
  }
  if (typeof options.minBytes === 'number' && options.bytes < options.minBytes) {
    throw new Error(
      `Downloaded asset size ${options.bytes} is below minimum ${options.minBytes}.`,
    );
  }
  if (typeof options.maxBytes === 'number' && options.bytes > options.maxBytes) {
    throw new Error(
      `Downloaded asset size ${options.bytes} exceeds maximum ${options.maxBytes}.`,
    );
  }
}

export class HttpModelAssetDownloader implements ModelAssetDownloader {
  constructor(
    private readonly options: {
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {}

  async ensure(input: {
    url: string;
    destinationPath: string;
    sha256?: string;
    bytes?: number;
    minBytes?: number;
    maxBytes?: number;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    if (existsSync(input.destinationPath)) {
      const existing = readFileSync(input.destinationPath);
      try {
        this.verify(existing, input);
        return;
      } catch {
        unlinkSync(input.destinationPath);
      }
    }

    mkdirSync(dirname(input.destinationPath), { recursive: true });
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeout = AbortSignal.timeout(
      this.options.timeoutMs ?? DEFAULT_BUNDLED_MODEL_DOWNLOAD_TIMEOUT_MS,
    );
    const response = await fetchImpl(input.url, {
      signal: input.abortSignal ?? timeout,
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'mitii-bundled-embedding',
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to download embedding model asset (${response.status}): ${input.url}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    this.verify(buffer, input);
    const tempPath = `${input.destinationPath}.download`;
    writeFileSync(tempPath, buffer);
    renameSync(tempPath, input.destinationPath);
  }

  private verify(
    buffer: Buffer,
    input: {
      sha256?: string;
      bytes?: number;
      minBytes?: number;
      maxBytes?: number;
    },
  ): void {
    assertSize({
      bytes: buffer.byteLength,
      expected: input.bytes,
      minBytes: input.minBytes,
      maxBytes: input.maxBytes,
    });
    if (input.sha256 && sha256(buffer) !== input.sha256) {
      throw new Error('Downloaded asset checksum did not match the catalog sha256.');
    }
  }
}
