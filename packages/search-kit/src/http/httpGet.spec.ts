import { describe, expect, it, vi } from 'vitest';

import { httpGet, sanitizeErrorMessage } from './httpGet.js';

describe('sanitizeErrorMessage', () => {
  it('redacts API keys and bearer tokens', () => {
    expect(
      sanitizeErrorMessage('failed ?api_key=secret123&x=1 Bearer abc.def'),
    ).toMatch(/api_key=\*\*\*/);
    expect(sanitizeErrorMessage('Bearer abc.def')).toContain('Bearer ***');
    expect(sanitizeErrorMessage('sk-abcdefghijklmnop')).toContain('sk-***');
  });
});

describe('httpGet', () => {
  it('follows a single redirect and caps body bytes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/final' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('abcdefghij', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

    const result = await httpGet({
      url: 'https://example.com/start',
      timeoutMs: 5_000,
      maxBodyBytes: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.url).toBe('https://example.com/final');
    expect(result.body).toBe('abcd');
    expect(result.truncated).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects private content URLs by default', async () => {
    await expect(
      httpGet({
        url: 'http://127.0.0.1/x',
        timeoutMs: 1_000,
        maxBodyBytes: 100,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/private or local/);
  });
});
