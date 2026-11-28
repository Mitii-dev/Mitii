import { describe, expect, it } from 'vitest';

import { resolveIndexTone } from '../src/renderer/indexing/IndexStatusChip.js';

describe('resolveIndexTone', () => {
  it('is ready when lexical index exists and semantic is only disabled', () => {
    expect(
      resolveIndexTone(
        {
          indexed: true,
          fileCount: 19,
          truncated: false,
          lexicalReady: true,
          message: 'Lexical ready',
          embeddingError: 'Semantic index is disabled or not configured.',
        },
        false,
      ),
    ).toBe('ready');
  });

  it('warns on a real embedding failure', () => {
    expect(
      resolveIndexTone(
        {
          indexed: true,
          fileCount: 19,
          truncated: false,
          lexicalReady: true,
          message: 'Indexed with embedding issue',
          embeddingError: 'onnx_load_failed',
        },
        false,
      ),
    ).toBe('warn');
  });
});
