import { describe, expect, it } from 'vitest';

import { parseScipJsonl } from './ScipEnrichmentAdapter.js';

describe('parseScipJsonl', () => {
  it('parses occurrence rows', () => {
    const raw = [
      JSON.stringify({
        relative_path: 'src/a.ts',
        start_line: 12,
        symbol_name: 'foo',
        symbol: 'scip-typescript npm . a.ts foo/',
      }),
      '',
      '{bad',
    ].join('\n');
    expect(parseScipJsonl(raw)).toEqual([
      {
        relativePath: 'src/a.ts',
        line: 12,
        symbolName: 'foo',
        scipSymbol: 'scip-typescript npm . a.ts foo/',
      },
    ]);
  });
});
