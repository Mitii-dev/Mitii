import { describe, expect, it } from 'vitest';

import {
  extractScipSymbolName,
  parseScipIndexBinary,
} from './parseScipIndexBinary.js';

describe('parseScipIndexBinary', () => {
  it('extractScipSymbolName takes the last descriptor token', () => {
    expect(
      extractScipSymbolName('scip-typescript npm . `src/a.ts`/ foo().'),
    ).toBe('foo');
    expect(extractScipSymbolName('')).toBe('');
  });

  it('returns empty when bytes are invalid', async () => {
    expect(await parseScipIndexBinary(new Uint8Array([0, 1, 2, 3]))).toEqual(
      [],
    );
  });

  it('decodes a minimal Index when protobuf deps are present', async () => {
    let toBinary: (schema: unknown, message: unknown) => Uint8Array;
    let create: (schema: unknown, init: unknown) => unknown;
    let IndexSchema: unknown;
    try {
      const protobuf = await import('@bufbuild/protobuf');
      const scip = await import('@scip-code/scip');
      toBinary = protobuf.toBinary as typeof toBinary;
      create = protobuf.create as typeof create;
      IndexSchema = scip.IndexSchema;
    } catch {
      return; // optional deps not installed in this environment
    }

    const message = create(IndexSchema, {
      documents: [
        {
          relativePath: 'src/a.ts',
          occurrences: [
            {
              symbol: 'scip-typescript npm . a.ts foo().',
              range: [11, 0, 3],
              symbolRoles: 1,
            },
          ],
        },
      ],
    });
    const bytes = toBinary(IndexSchema, message);
    expect(await parseScipIndexBinary(bytes)).toEqual([
      {
        relativePath: 'src/a.ts',
        line: 12,
        symbolName: 'foo',
        scipSymbol: 'scip-typescript npm . a.ts foo().',
        referenceKind: 'definition',
      },
    ]);
  });
});
