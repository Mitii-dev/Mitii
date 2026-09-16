import { describe, expect, it } from 'vitest';
import {
  dedupeByIou,
  lineIou,
  SUMMARY_MARKER,
} from './post-mitii-review-comments.js';

describe('post-mitii-review-comments helpers', () => {
  it('computes line IoU', () => {
    expect(lineIou(1, 5, 3, 7)).toBeCloseTo(3 / 7);
    expect(lineIou(1, 2, 10, 11)).toBe(0);
  });

  it('dedupes overlapping findings keeping higher severity', () => {
    const kept = dedupeByIou(
      [
        {
          path: 'a.ts',
          startLine: 10,
          endLine: 12,
          severity: 'low',
          content: 'nit',
        },
        {
          path: 'a.ts',
          startLine: 10,
          endLine: 12,
          severity: 'high',
          content: 'bug',
        },
      ],
      0.6,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].severity).toBe('high');
  });

  it('exports sticky summary marker', () => {
    expect(SUMMARY_MARKER).toContain('mitii-review-summary');
  });
});
