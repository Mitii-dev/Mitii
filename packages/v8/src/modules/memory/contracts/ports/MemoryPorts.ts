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

  /** Execute a synchronous decision against current scoped rows and persist its
   * complete write set atomically. Never await external I/O inside the decision. */
  transact?<T>(scope: MemoryScope, decide: (facts: readonly MemoryFact[]) => {
    facts: readonly MemoryFact[];
    result: T;
  }): Promise<T> | T;

  /** Optional listing for hosts that expose scoped inventory outside retrieve. */
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
  readonly profileId?: string;
  readonly dimensions: number;
  embed(text: string, signal?: AbortSignal): Promise<Float32Array> | Float32Array;
  embedBatch?(texts: readonly string[], signal?: AbortSignal): Promise<readonly Float32Array[]>;
}

export type { MemoryCommitInput };
