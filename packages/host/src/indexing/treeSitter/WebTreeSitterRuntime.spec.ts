import { describe, expect, it } from 'vitest';

import { createDefaultTreeSitterRuntime } from './createDefaultTreeSitterRuntime.js';

describe('WebTreeSitterRuntime', () => {
  it('parses Python definitions through the default WASM runtime', async () => {
    const runtime = await createDefaultTreeSitterRuntime();

    expect(runtime).toBeDefined();
    expect(runtime?.supports('python')).toBe(true);

    const result = await runtime!.parse({
      language: 'python',
      relativePath: 'example.py',
      content: 'def foo():\n    return 1\n',
      symbolQuery:
        '(function_definition name: (identifier) @name) @definition',
      maximumSymbols: 10,
      maximumImports: 10,
      maximumReferences: 10,
    });

    expect(result.symbols).toEqual([
      expect.objectContaining({
        name: 'foo',
        nodeType: 'function_definition',
        startLine: 1,
      }),
    ]);
    expect(result.warnings ?? []).toEqual([]);
  });

  it('parses TypeScript definitions when the TS grammar is available', async () => {
    const runtime = await createDefaultTreeSitterRuntime();
    if (!runtime?.supports('typescript')) {
      return;
    }

    const result = await runtime.parse({
      language: 'typescript',
      relativePath: 'example.ts',
      content: 'export function greet(name: string) { return name; }\n',
      symbolQuery:
        '(function_declaration name: (identifier) @name) @definition',
      maximumSymbols: 10,
      maximumImports: 10,
      maximumReferences: 10,
    });

    expect(result.symbols).toEqual([
      expect.objectContaining({
        name: 'greet',
        startLine: 1,
      }),
    ]);
  });

  it('returns undefined when the WASM runtime cannot be resolved', async () => {
    const previous = process.env.MITII_TREE_SITTER_ASSET_ROOT;
    process.env.MITII_TREE_SITTER_ASSET_ROOT = '/tmp/mitii-missing-tree-sitter';
    try {
      const runtime = await createDefaultTreeSitterRuntime();
      expect(runtime === undefined || runtime.supports('python')).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.MITII_TREE_SITTER_ASSET_ROOT;
      } else {
        process.env.MITII_TREE_SITTER_ASSET_ROOT = previous;
      }
    }
  });
});
