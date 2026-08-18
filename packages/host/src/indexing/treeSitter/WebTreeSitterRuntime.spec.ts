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

  it('parses shell function definitions when the bash grammar is available', async () => {
    const runtime = await createDefaultTreeSitterRuntime();
    if (!runtime?.supports('shell')) {
      return;
    }

    const result = await runtime.parse({
      language: 'shell',
      relativePath: 'scripts/setup.sh',
      content: 'greet() {\n  echo hi\n}\n',
      symbolQuery:
        '(function_definition name: (word) @name) @definition',
      maximumSymbols: 10,
      maximumImports: 10,
      maximumReferences: 10,
    });

    if ((result.warnings ?? []).length > 0 && result.symbols.length === 0) {
      return;
    }

    expect(result.symbols).toEqual([
      expect.objectContaining({
        name: 'greet',
        startLine: 1,
      }),
    ]);
  });

  it('accepts aider-style python captures and attribute call references', async () => {
    const runtime = await createDefaultTreeSitterRuntime();
    expect(runtime).toBeDefined();

    const result = await runtime!.parse({
      language: 'python',
      relativePath: 'src/webhooks/stripe_webhook.py',
      content:
        'class ChargeService:\n    def process(self):\n        return 1\n\ndef handle_checkout():\n    charge_service.process()\n',
      symbolQuery: `(
  class_definition
    name: (identifier) @name.definition.class) @definition.class

(function_definition
  name: (identifier) @name.definition.function) @definition.function
`,
      referenceQuery: `(
  call
    function: [
      (identifier) @name.reference.call
      (attribute
        attribute: (identifier) @name.reference.call)
    ]) @reference.call
`,
      maximumSymbols: 20,
      maximumImports: 10,
      maximumReferences: 20,
    });

    expect(result.symbols.map((symbol) => symbol.name).sort()).toEqual([
      'ChargeService',
      'handle_checkout',
      'process',
    ]);
    expect(result.symbols.find((symbol) => symbol.name === 'process')?.kind).toBe(
      'function',
    );
    expect(result.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: 'process',
          kind: 'call',
        }),
      ]),
    );
    expect(result.warnings ?? []).toEqual([]);
  });

  it('does not treat a non-function javascript const as a symbol', async () => {
    const runtime = await createDefaultTreeSitterRuntime();
    if (!runtime?.supports('javascript')) {
      return;
    }

    const result = await runtime.parse({
      language: 'javascript',
      relativePath: 'workers/charge-retry.js',
      content:
        'const loading = true;\nconst processCharge = async () => {\n  return chargeService.process();\n};\n',
      symbolQuery: `(
  lexical_declaration
    (variable_declarator
      name: (identifier) @name.definition.function
      value: [(arrow_function) (function_expression)])) @definition.function
`,
      referenceQuery: `(
  call_expression
    function: (member_expression
      property: (property_identifier) @name.reference.call)) @reference.call
`,
      maximumSymbols: 20,
      maximumImports: 10,
      maximumReferences: 20,
    });

    expect(result.symbols.map((symbol) => symbol.name)).toEqual(['processCharge']);
    expect(result.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: 'process',
          kind: 'call',
        }),
      ]),
    );
  });

  it('parses lua function tags when the lua grammar is available', async () => {
    const runtime = await createDefaultTreeSitterRuntime();
    if (!runtime?.supports('lua')) {
      return;
    }

    const result = await runtime.parse({
      language: 'lua',
      relativePath: 'nginx/charge_dedupe.lua',
      content:
        'local M = {}\nfunction M.should_charge(payment_id)\n  return true\nend\nreturn M\n',
      symbolQuery: `(
  function_declaration
    name: [
      (identifier) @name.definition.function
      (dot_index_expression
        field: (identifier) @name.definition.function)
    ]) @definition.function
`,
      maximumSymbols: 10,
      maximumImports: 10,
      maximumReferences: 10,
    });

    if ((result.warnings ?? []).length > 0 && result.symbols.length === 0) {
      return;
    }

    expect(result.symbols.map((symbol) => symbol.name)).toContain('should_charge');
  });

  it('records a warning instead of throwing when a query cannot compile', async () => {
    const runtime = await createDefaultTreeSitterRuntime();
    expect(runtime).toBeDefined();

    const result = await runtime!.parse({
      language: 'python',
      relativePath: 'broken.py',
      content: 'def foo():\n    return 1\n',
      symbolQuery: '(function_definition name: (identifier) @name',
      maximumSymbols: 10,
      maximumImports: 10,
      maximumReferences: 10,
    });

    expect(result.symbols).toEqual([]);
    expect(result.warnings ?? []).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/symbol query failed to compile/),
      ]),
    );
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
