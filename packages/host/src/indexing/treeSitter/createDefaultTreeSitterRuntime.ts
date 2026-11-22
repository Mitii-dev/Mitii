import type {
  TreeSitterRuntimePort,
} from '@mitii/v8';

import { NativeTreeSitterRuntime } from './NativeTreeSitterRuntime.js';
import { PreferNativeTreeSitterRuntime } from './PreferNativeTreeSitterRuntime.js';
import {
  WEB_TREE_SITTER_GRAMMAR_WASM_BY_LANGUAGE,
  WebTreeSitterRuntime,
  resolveTreeSitterPackageAsset,
} from './WebTreeSitterRuntime.js';

export async function createDefaultTreeSitterRuntime(): Promise<
  TreeSitterRuntimePort | undefined
> {
  const wasm = await createWasmTreeSitterRuntime();
  const native = new NativeTreeSitterRuntime();

  if (wasm && native.supports('python')) {
    return new PreferNativeTreeSitterRuntime(native, wasm);
  }
  if (wasm) {
    // Still prefer native when available for any language; WASM covers the rest.
    return new PreferNativeTreeSitterRuntime(native, wasm);
  }
  if (native.supports('typescript') || native.supports('python')) {
    return native;
  }
  return undefined;
}

async function createWasmTreeSitterRuntime(): Promise<
  TreeSitterRuntimePort | undefined
> {
  const coreWasmPath = resolveTreeSitterPackageAsset([
    'web-tree-sitter/tree-sitter.wasm',
    'web-tree-sitter/web-tree-sitter.wasm',
  ]);

  if (!coreWasmPath) {
    return undefined;
  }

  try {
    await import('web-tree-sitter');
  } catch {
    return undefined;
  }

  const grammarWasmPaths: Record<string, string> = {};

  for (const [language, basename] of Object.entries(
    WEB_TREE_SITTER_GRAMMAR_WASM_BY_LANGUAGE,
  )) {
    const wasmPath = resolveTreeSitterPackageAsset([
      `tree-sitter-wasms/out/${basename}`,
      basename,
    ]);

    if (wasmPath) {
      grammarWasmPaths[language] = wasmPath;
    }
  }

  if (Object.keys(grammarWasmPaths).length === 0) {
    return undefined;
  }

  const runtime = new WebTreeSitterRuntime({
    coreWasmPath,
    grammarWasmPaths,
  });

  if (runtime.supports('python')) {
    try {
      await runtime.parse({
        language: 'python',
        relativePath: '__tree_sitter_probe__.py',
        content: 'def __mitii_tree_sitter_probe__():\n  pass\n',
        symbolQuery:
          '(function_definition name: (identifier) @name) @definition',
        maximumSymbols: 1,
        maximumImports: 1,
        maximumReferences: 1,
      });
    } catch {
      return undefined;
    }
  }

  return runtime;
}
