import { describe, expect, it } from 'vitest';
import { parseDotEnv } from '../src/loadDotEnv.js';

describe('parseDotEnv', () => {
  it('parses keys, quotes, and skips comments', () => {
    const rows = parseDotEnv(`
# comment
MITII_PROVIDER=anthropic
MITII_MODEL="claude-sonnet-4-5"
EMPTY=
ANTHROPIC_API_KEY='sk-ant-test'
not a line
`);
    expect(rows).toEqual([
      { key: 'MITII_PROVIDER', value: 'anthropic' },
      { key: 'MITII_MODEL', value: 'claude-sonnet-4-5' },
      { key: 'EMPTY', value: '' },
      { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-test' },
    ]);
  });
});
