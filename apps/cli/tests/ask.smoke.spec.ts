import { describe, expect, it } from 'vitest';

import { main } from '../src/cli.js';
import type { SessionIo } from '../src/session.js';

describe('CLI ask smoke', () => {
  it('completes a non-mutating ask via @mitii/sdk with Echo', async () => {
    const chunks: string[] = [];
    const errChunks: string[] = [];
    const io: SessionIo = {
      writeStdout: (chunk) => {
        chunks.push(chunk);
      },
      writeStderr: (chunk) => {
        errChunks.push(chunk);
      },
      prompt: async () => '',
    };

    const code = await main(
      ['node', 'mitii', 'ask', 'What is recursion?', '--echo', '--json'],
      io,
    );
    expect(code).toBe(0);
    const payload = JSON.parse(chunks.join('')) as {
      result: { status: string; route?: string; answer?: string };
    };
    expect(payload.result.status).toBe('completed');
    expect(payload.result.route).toBe('direct_answer');
    expect(payload.result.answer).toContain('Echo:');
    // Full session JSONL is enabled by default; path is suppressed for --json.
    expect(errChunks.join('')).not.toMatch(/\[mitii\] log=/);
  }, 30_000);
});
