import { describe, expect, it } from 'vitest';

import { summarizeReviewFindings, type ReviewFindingChip } from '../src/index.js';

const finding = (
  path: string,
  status?: ReviewFindingChip['status'],
): ReviewFindingChip => ({ path, content: `issue in ${path}`, severity: 'high', status });

describe('summarizeReviewFindings', () => {
  it('returns an empty, incomplete summary for no findings', () => {
    expect(summarizeReviewFindings([])).toEqual({
      open: [],
      fixed: [],
      total: 0,
      complete: false,
    });
  });

  it('treats findings without a status as open', () => {
    const s = summarizeReviewFindings([finding('a.ts'), finding('b.ts', 'open')]);
    expect(s.open).toHaveLength(2);
    expect(s.fixed).toHaveLength(0);
    expect(s.complete).toBe(false);
  });

  it('is incomplete while any finding is open', () => {
    const s = summarizeReviewFindings([finding('a.ts', 'fixed'), finding('b.ts')]);
    expect(s.open.map((f) => f.path)).toEqual(['b.ts']);
    expect(s.fixed.map((f) => f.path)).toEqual(['a.ts']);
    expect(s.total).toBe(2);
    expect(s.complete).toBe(false);
  });

  it('is complete once every finding is fixed', () => {
    const s = summarizeReviewFindings([finding('a.ts', 'fixed'), finding('b.ts', 'fixed')]);
    expect(s.open).toHaveLength(0);
    expect(s.complete).toBe(true);
  });
});
