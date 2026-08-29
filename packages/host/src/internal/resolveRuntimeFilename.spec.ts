import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRuntimeFilename } from './resolveRuntimeFilename.js';
import { resolveTreeSitterPackageAsset } from '../indexing/treeSitter/WebTreeSitterRuntime.js';

describe('resolveRuntimeFilename', () => {
  it('returns an absolute path that createRequire can consume', () => {
    const filename = resolveRuntimeFilename();

    expect(isAbsolute(filename)).toBe(true);
    expect(() => createRequire(filename)).not.toThrow();
  });

  it('lets tree-sitter asset lookup run without a module-load createRequire', () => {
    expect(() =>
      resolveTreeSitterPackageAsset(['web-tree-sitter/tree-sitter.wasm']),
    ).not.toThrow();
  });
});
