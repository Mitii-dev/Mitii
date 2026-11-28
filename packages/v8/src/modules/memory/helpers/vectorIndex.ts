function float32ToBase64(values: Float32Array): string {
  return Buffer.from(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  ).toString("base64");
}

function base64ToFloat32(encoded: string): Float32Array {
  const buffer = Buffer.from(encoded, "base64");
  return new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

export function cosineSimilarity(
  left: Float32Array,
  right: Float32Array,
): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    normLeft += a * a;
    normRight += b * b;
  }
  const denom = Math.sqrt(normLeft) * Math.sqrt(normRight);
  return denom === 0 ? 0 : dot / denom;
}

export interface VectorHit {
  id: string;
  score: number;
}

/**
 * Brute-force cosine index for one retrieve call.
 * Hosts may persist a copy; facts remain the source of truth.
 */
export class MemoryVectorIndex {
  private readonly vectors = new Map<string, Float32Array>();

  public add(id: string, embedding: Float32Array): void {
    this.vectors.set(id, embedding);
  }

  public search(query: Float32Array, limit: number): VectorHit[] {
    const hits: VectorHit[] = [];
    for (const [id, embedding] of this.vectors) {
      hits.push({ id, score: cosineSimilarity(query, embedding) });
    }
    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  public validateDimensions(expected: number): {
    mismatches: Array<{ id: string; dim: number }>;
  } {
    const mismatches: Array<{ id: string; dim: number }> = [];
    for (const [id, embedding] of this.vectors) {
      if (embedding.length !== expected) {
        mismatches.push({ id, dim: embedding.length });
      }
    }
    return { mismatches };
  }

  public serialize(): string {
    return JSON.stringify(
      [...this.vectors.entries()].map(([id, embedding]) => [
        id,
        float32ToBase64(embedding),
      ]),
    );
  }

  public static deserialize(json: string): MemoryVectorIndex {
    const index = new MemoryVectorIndex();
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return index;
    }
    if (!Array.isArray(parsed)) {
      return index;
    }
    for (const row of parsed) {
      if (!Array.isArray(row) || row.length < 2) {
        continue;
      }
      const [id, encoded] = row;
      if (typeof id !== "string" || typeof encoded !== "string") {
        continue;
      }
      index.add(id, base64ToFloat32(encoded));
    }
    return index;
  }
}
