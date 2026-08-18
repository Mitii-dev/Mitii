import type { MemoryEmbeddingPort } from "../contracts";
import { tokenize } from "../internal/tokenize";

/**
 * Deterministic hashed bag-of-tokens embedding for tests and hosts
 * that have not injected a real model. Same tokens land in the same bins.
 */
export class HashMemoryEmbedding implements MemoryEmbeddingPort {
  public readonly dimensions: number;

  constructor(dimensions = 32) {
    this.dimensions = dimensions;
  }

  public embed(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions);
    for (const token of tokenize(text)) {
      let hash = 0;
      for (let index = 0; index < token.length; index += 1) {
        hash = (hash * 31 + token.charCodeAt(index)) >>> 0;
      }
      const slot = hash % this.dimensions;
      vector[slot] = (vector[slot] ?? 0) + 1;
    }
    let norm = 0;
    for (const value of vector) {
      norm += value * value;
    }
    const scale = Math.sqrt(norm);
    if (scale > 0) {
      for (let index = 0; index < vector.length; index += 1) {
        vector[index] = (vector[index] ?? 0) / scale;
      }
    }
    return vector;
  }
}
