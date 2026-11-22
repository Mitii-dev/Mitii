/**
 * Prefer native tree-sitter when a grammar is available; else WASM.
 */

import type {
  TreeSitterRuntimeParseInput,
  TreeSitterRuntimeParseResult,
  TreeSitterRuntimePort,
} from '@mitii/v8';

export class PreferNativeTreeSitterRuntime implements TreeSitterRuntimePort {
  public readonly id = 'prefer-native-tree-sitter';

  constructor(
    private readonly native: TreeSitterRuntimePort,
    private readonly wasm: TreeSitterRuntimePort,
  ) {}

  public supports(language: string): boolean {
    return this.native.supports(language) || this.wasm.supports(language);
  }

  public async parse(
    input: TreeSitterRuntimeParseInput,
  ): Promise<TreeSitterRuntimeParseResult> {
    if (this.native.supports(input.language)) {
      try {
        const result = await this.native.parse(input);
        if (result.symbols.length > 0 || !this.wasm.supports(input.language)) {
          return result;
        }
        // Empty native result with WASM available → try WASM for accuracy.
      } catch {
        /* fall through to WASM */
      }
    }
    return this.wasm.parse(input);
  }
}
