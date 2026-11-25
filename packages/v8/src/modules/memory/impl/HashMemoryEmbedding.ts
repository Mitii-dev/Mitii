import type { MemoryEmbeddingPort } from "../types";
import { hashEmbed } from "./hash/embed";

/**
 * Deterministic hashed bag-of-tokens embedding for tests and hosts
 * that have not injected a real model. Same tokens land in the same bins.
 * Port method body: `impl/hash-embed.ts`.
 */
export class HashMemoryEmbedding implements MemoryEmbeddingPort {
  public readonly dimensions: number;

  constructor(dimensions = 32) {
    this.dimensions = dimensions;
  }

  public embed(text: string): Float32Array {
    return hashEmbed(text, this.dimensions);
  }
}
