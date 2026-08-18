import type { MemoryCommitInput, MemoryRetrieveInput } from "../input/MemoryInput";
import type { MemoryFact, MemoryScope } from "../output/MemoryFact";

/**
 * Host/application supplies durable memory storage.
 * Memory never writes outside this port.
 */
export interface MemoryStorePort {
  query(input: {
    scope: MemoryRetrieveInput["scope"];
    query: string;
  }): Promise<readonly MemoryFact[]> | readonly MemoryFact[];

  commit(fact: MemoryFact): Promise<void> | void;

  /** Needed for Jaccard supersede / hash reinforce. Hosts already persist lists. */
  list?(scope?: MemoryScope): Promise<readonly MemoryFact[]> | readonly MemoryFact[];

  /** Increment access timestamps after a successful retrieve. */
  recordAccess?(
    ids: readonly string[],
    at: string,
  ): Promise<void> | void;
}

export interface MemoryIdGeneratorPort {
  next(prefix: string): string;
}

/**
 * Optional host embedding space. Omit → BM25 + file retrieve only.
 * Must not pull model runtimes into `@mitii/v8`.
 */
export interface MemoryEmbeddingPort {
  readonly dimensions: number;
  embed(text: string): Promise<Float32Array> | Float32Array;
}

export type { MemoryCommitInput };
