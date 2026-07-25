import {
  CodeIndexContext,
  CodeIndexFileQuery,
  CodeIndexFileQueryResult,
  CodeIndexImport,
  CodeIndexReference,
  CodeIndexSymbol,
  CodeIndexSymbolQuery,
} from "./types";

export interface CodeIndexReadPort {
  readonly id: string;

  /**
   * Must be fast, deterministic and side-effect-free.
   */
  getChangeToken(context: CodeIndexContext): Promise<string>;

  /**
   * Returned files must be members of context.snapshot.
   */
  getFiles(
    query: CodeIndexFileQuery,
    context: CodeIndexContext,
  ): Promise<CodeIndexFileQueryResult>;

  /**
   * Must return an entry for every requested file ID.
   *
   * Files without symbols map to an empty array.
   */
  getSymbols(
    query: CodeIndexSymbolQuery,
    context: CodeIndexContext,
  ): Promise<ReadonlyMap<string, readonly CodeIndexSymbol[]>>;

  /**
   * Returns imports originating from requested files.
   */
  getImports(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<readonly CodeIndexImport[]>;

  /**
   * Returns references originating from requested files.
   */
  getReferences(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<readonly CodeIndexReference[]>;
}
