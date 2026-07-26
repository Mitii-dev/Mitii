import { describe, expect, it } from 'vitest';

import { main } from '../src/cli.js';

describe('CLI ask smoke (Phase 15)', () => {
  it('completes a non-mutating ask via @mitii/sdk with Echo', async () => {
    const chunks: string[] = [];
    const errChunks: string[] = [];
    const originalStdout = process.stdout.write.bind(process.stdout);
    const originalStderr = process.stderr.write.bind(process.stderr);

    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const code = await main([
        'node',
        'mitii',
        'ask',
        'What is recursion?',
        '--echo',
        '--json',
      ]);
      expect(code).toBe(0);
      const payload = JSON.parse(chunks.join('')) as {
        result: { status: string; route?: string; answer?: string };
      };
      expect(payload.result.status).toBe('completed');
      expect(payload.result.route).toBe('direct_answer');
      expect(payload.result.answer).toContain('Echo:');
    } finally {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    }
  });
});
