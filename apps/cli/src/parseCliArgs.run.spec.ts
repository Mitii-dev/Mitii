import { describe, expect, it } from 'vitest';

import { parseCliArgs } from './parseCliArgs.js';

describe('parseCliArgs run --auto', () => {
  it('parses run with --auto and prompt', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      'run',
      '--auto',
      'fix tests',
      '--echo',
    ]);
    expect(parsed.command).toBe('run');
    expect(parsed.auto).toBe(true);
    expect(parsed.prompt).toBe('fix tests');
    expect(parsed.forceEcho).toBe(true);
  });
});
