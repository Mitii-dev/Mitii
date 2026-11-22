import { describe, expect, it } from 'vitest';

import { fileDir, fileLeaf } from '../src/renderer/git/scmPathUtils.js';

describe('scmPathUtils', () => {
  it('fileLeaf returns the last path segment', () => {
    expect(fileLeaf('src/a/b.ts')).toBe('b.ts');
    expect(fileLeaf('b.ts')).toBe('b.ts');
  });

  it('fileLeaf normalizes backslashes and falls back to the input', () => {
    expect(fileLeaf('src\\a\\b.ts')).toBe('b.ts');
    expect(fileLeaf('dir/')).toBe('dir/');
  });

  it('fileDir returns the parent directory', () => {
    expect(fileDir('src/a/b.ts')).toBe('src/a');
    expect(fileDir('src\\a\\b.ts')).toBe('src/a');
  });

  it('fileDir returns empty for root-level files', () => {
    expect(fileDir('b.ts')).toBe('');
    expect(fileDir('/b.ts')).toBe('');
  });
});
