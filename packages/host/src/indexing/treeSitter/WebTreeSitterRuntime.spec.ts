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
});
