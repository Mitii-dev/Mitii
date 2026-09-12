import { describe, expect, it } from 'vitest';

import { cumulativeChangedPathsSince } from '../src/diff/cumulativeCheckpointDiff.ts';

describe('cumulativeChangedPathsSince', () => {
  it('unions paths from newest through the selected checkpoint', () => {
    const checkpoints = [
      {
        id: 'cp3',
        label: 'third',
        createdAt: '2026-01-03T00:00:00.000Z',
        changedPaths: ['c.ts'],
      },
      {
        id: 'cp2',
        label: 'second',
        createdAt: '2026-01-02T00:00:00.000Z',
        changedPaths: ['a.ts', 'b.ts'],
      },
      {
        id: 'cp1',
        label: 'first',
        createdAt: '2026-01-01T00:00:00.000Z',
        changedPaths: ['a.ts'],
      },
    ];

    const fromSecond = cumulativeChangedPathsSince(checkpoints, 'cp2');
    expect(fromSecond.paths).toEqual(['a.ts', 'b.ts', 'c.ts']);

    const fromThird = cumulativeChangedPathsSince(checkpoints, 'cp3');
    expect(fromThird.paths).toEqual(['c.ts']);

    const missing = cumulativeChangedPathsSince(checkpoints, 'nope');
    expect(missing.paths).toEqual([]);
  });
});
