/**
 * Offload large tool outputs to `.mitii/debug-blobs/<sha256>.txt`
 * so the compact JSONL audit log only stores previews + content hashes.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PREVIEW_CHARS = 500;
const BLOB_THRESHOLD = 2_000;

export interface CompactToolOutputRef {
  preview: string;
  outputBytes: number;
  outputSha256: string;
  blobPath?: string;
}

export function storeDebugBlob(
  workspace: string,
  content: string
): CompactToolOutputRef {
  const outputBytes = Buffer.byteLength(content, 'utf-8');
  const outputSha256 = createHash('sha256').update(content, 'utf-8').digest('hex');
  const preview = content.slice(0, PREVIEW_CHARS);

  if (outputBytes < BLOB_THRESHOLD || !workspace) {
    return { preview, outputBytes, outputSha256 };
  }

  const dir = join(workspace, '.mitii', 'debug-blobs');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const blobPath = join(dir, `${outputSha256}.txt`);
  if (!existsSync(blobPath)) {
    writeFileSync(blobPath, content, 'utf-8');
  }

  return {
    preview,
    outputBytes,
    outputSha256,
    blobPath: `.mitii/debug-blobs/${outputSha256}.txt`,
  };
}
