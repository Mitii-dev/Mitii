import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_INDEX_CONCURRENCY,
  RECOMMENDED_INDEX_CONCURRENCY_MAX,
  RECOMMENDED_INDEX_CONCURRENCY_MIN,
  resolveIndexConcurrency,
} from './indexLimits.js';

describe('resolveIndexConcurrency', () => {
  it('honors an explicit request within bounds', () => {
    expect(resolveIndexConcurrency(4)).toBe(4);
    expect(resolveIndexConcurrency(8)).toBe(8);
    expect(resolveIndexConcurrency(100)).toBe(MAXIMUM_INDEX_CONCURRENCY);
    expect(resolveIndexConcurrency(0)).toBeGreaterThanOrEqual(
      RECOMMENDED_INDEX_CONCURRENCY_MIN,
    );
  });

  it('stays in the interactive 4–8 band by default', () => {
    const previous = process.env.MITII_INDEX_CONCURRENCY;
    delete process.env.MITII_INDEX_CONCURRENCY;
    try {
      const value = resolveIndexConcurrency();
      expect(value).toBeGreaterThanOrEqual(RECOMMENDED_INDEX_CONCURRENCY_MIN);
      expect(value).toBeLessThanOrEqual(RECOMMENDED_INDEX_CONCURRENCY_MAX);
    } finally {
      if (previous === undefined) delete process.env.MITII_INDEX_CONCURRENCY;
      else process.env.MITII_INDEX_CONCURRENCY = previous;
    }
  });

  it('reads MITII_INDEX_CONCURRENCY from the environment', () => {
    const previous = process.env.MITII_INDEX_CONCURRENCY;
    process.env.MITII_INDEX_CONCURRENCY = '7';
    try {
      expect(resolveIndexConcurrency()).toBe(7);
    } finally {
      if (previous === undefined) delete process.env.MITII_INDEX_CONCURRENCY;
      else process.env.MITII_INDEX_CONCURRENCY = previous;
    }
  });
});
