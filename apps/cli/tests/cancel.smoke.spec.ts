import { describe, expect, it } from 'vitest';

import { createCliClient } from '../src/ports.js';

describe('Phase 17 cancel smoke', () => {
  it('cancels an in-flight echo run', async () => {
    const { client } = createCliClient({
      cwd: process.cwd(),
      forceEcho: true,
    });
    const run = client.start({ prompt: 'cancel me please' });
    run.cancel('user_cancelled');
    const result = await run.result;
    expect(result.status).toBe('cancelled');
  });
});
