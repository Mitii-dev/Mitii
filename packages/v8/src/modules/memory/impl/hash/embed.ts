import { tokenize } from "../../helpers/tokenize";

/** Port method: `MemoryEmbeddingPort.embed`. */
export function hashEmbed(text: string, dimensions: number): Float32Array {
  const vector = new Float32Array(dimensions);
  for (const token of tokenize(text)) {
    let hash = 0;
    for (let index = 0; index < token.length; index += 1) {
      hash = (hash * 31 + token.charCodeAt(index)) >>> 0;
    }
    const slot = hash % dimensions;
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
