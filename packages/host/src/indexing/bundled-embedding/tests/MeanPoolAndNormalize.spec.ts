import { describe, expect, it } from 'vitest';

import {
  l2Normalize,
  meanPoolAndNormalize,
  meanPoolLastHiddenState,
} from '../actions/MeanPoolAndNormalize.js';

describe('mean pool and normalize', () => {
  it('masks padded tokens before averaging', () => {
    const hidden = [
      1, 0, 0,
      9, 9, 9,
    ];
    expect(
      meanPoolLastHiddenState({
        hiddenState: hidden,
        dims: [1, 2, 3],
        attentionMask: [1, 0],
        batchIndex: 0,
      }),
    ).toEqual([1, 0, 0]);
  });

  it('L2-normalizes pooled vectors', () => {
    expect(l2Normalize([3, 4])).toEqual([0.6, 0.8]);
    const [vector] = meanPoolAndNormalize({
      hiddenState: [3, 4],
      dims: [1, 1, 2],
      attentionMasks: [[1]],
      normalize: true,
    });
    expect(vector[0]).toBeCloseTo(0.6);
    expect(vector[1]).toBeCloseTo(0.8);
  });
});
