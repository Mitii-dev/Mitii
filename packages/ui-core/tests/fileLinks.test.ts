import { describe, expect, it } from 'vitest';

import {
  inlineCodeAsFileRef,
  looksLikeWorkspaceFileRef,
  parseFileRef,
} from '../src/index.js';

describe('fileLinks', () => {
  it('detects workspace file refs', () => {
    expect(looksLikeWorkspaceFileRef('apps/vscode/src/foo.ts')).toBe(true);
    expect(looksLikeWorkspaceFileRef('foo.ts:12')).toBe(true);
    expect(looksLikeWorkspaceFileRef('https://example.com')).toBe(false);
    expect(looksLikeWorkspaceFileRef('#anchor')).toBe(false);
  });

  it('parses path:line:col refs', () => {
    expect(parseFileRef('apps/a.ts:10:2')).toEqual({
      path: 'apps/a.ts',
      line: 10,
      column: 2,
    });
    expect(inlineCodeAsFileRef('protocol.ts')).toEqual({ path: 'protocol.ts' });
  });
});
