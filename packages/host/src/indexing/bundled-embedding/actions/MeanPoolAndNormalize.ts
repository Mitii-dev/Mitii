const EPSILON = 1e-9;

export function meanPoolLastHiddenState(options: {
  hiddenState: ArrayLike<number>;
  dims: readonly number[];
  attentionMask: readonly number[];
  batchIndex: number;
}): number[] {
  if (options.dims.length !== 3) {
    throw new Error(
      `MiniLM last hidden state must be rank-3 [batch, seq, hidden], received ${options.dims.join('x')}.`,
    );
  }
  const [, sequenceLength, hiddenSize] = options.dims;
  const offset = options.batchIndex * sequenceLength * hiddenSize;
  const pooled = new Array<number>(hiddenSize).fill(0);
  let counted = 0;

  for (let token = 0; token < sequenceLength; token += 1) {
    if ((options.attentionMask[token] ?? 0) <= 0) {
      continue;
    }
    counted += 1;
    const tokenOffset = offset + token * hiddenSize;
    for (let dim = 0; dim < hiddenSize; dim += 1) {
      pooled[dim] += Number(options.hiddenState[tokenOffset + dim] ?? 0);
    }
  }

  const divisor = Math.max(counted, 1);
  for (let dim = 0; dim < hiddenSize; dim += 1) {
    pooled[dim] /= divisor;
  }
  return pooled;
}

export function l2Normalize(vector: readonly number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error('Embedding vector contains a non-finite value.');
    }
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm <= EPSILON) {
    return vector.map(() => 0);
  }
  return vector.map((value) => value / norm);
}

export function meanPoolAndNormalize(options: {
  hiddenState: ArrayLike<number>;
  dims: readonly number[];
  attentionMasks: readonly (readonly number[])[];
  normalize: boolean;
}): number[][] {
  const batch = options.dims[0] ?? 0;
  const vectors: number[][] = [];
  for (let index = 0; index < batch; index += 1) {
    const pooled = meanPoolLastHiddenState({
      hiddenState: options.hiddenState,
      dims: options.dims,
      attentionMask: options.attentionMasks[index] ?? [],
      batchIndex: index,
    });
    vectors.push(options.normalize ? l2Normalize(pooled) : pooled);
  }
  return vectors;
}
