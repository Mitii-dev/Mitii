import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAXIMUM_INDEX_FILES,
  MAXIMUM_INDEX_FILES,
  resolveIndexScanTimeoutMs,
  resolveMaximumIndexFiles,
} from './indexLimits.js';

describe('index file limits', () => {
  it('defaults to 30k and allows scaling to 240k', () => {
    expect(resolveMaximumIndexFiles()).toBe(DEFAULT_MAXIMUM_INDEX_FILES);
    expect(resolveMaximumIndexFiles(0)).toBe(30_000);
    expect(resolveMaximumIndexFiles(30_000)).toBe(30_000);
    expect(resolveMaximumIndexFiles(240_000)).toBe(240_000);
    expect(resolveMaximumIndexFiles(500_000)).toBe(MAXIMUM_INDEX_FILES);
  });

  it('grows scan timeout with the file cap', () => {
    expect(resolveIndexScanTimeoutMs(30_000)).toBe(120_000);
    expect(resolveIndexScanTimeoutMs(240_000)).toBe(600_000);
  });
});
