import type { MemoryCommitInput, MemoryRetrieveInput } from "../input/MemoryInput";
import type { MemoryFact } from "../output/MemoryFact";

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
}

export interface MemoryIdGeneratorPort {
  next(prefix: string): string;
}

export type { MemoryCommitInput };
