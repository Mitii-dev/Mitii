import { describe, expect, it, vi } from 'vitest';

import {
  isTransientEngineNetworkError,
  withEngineFetchRetry,
} from '../src/renderer/engineNetwork';

describe('engineNetwork', () => {
  it('detects Chromium Failed to fetch / NetworkError blips', () => {
    expect(isTransientEngineNetworkError(new TypeError('Failed to fetch'))).toBe(
      true,
    );
    expect(
      isTransientEngineNetworkError(
        new TypeError('NetworkError when attempting to fetch resource.'),
      ),
    ).toBe(true);
    expect(isTransientEngineNetworkError(new Error('boom'))).toBe(false);
  });

  it('retries transient failures then succeeds', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('ok');
    await expect(
      withEngineFetchRetry(run, { attempts: 3, delayMs: 1 }),
    ).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
