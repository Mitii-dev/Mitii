import { describe, expect, it } from 'vitest';

import {
  buildEditFormatRepairHints,
  formatEditFormatRepairHints,
} from './editFormatRepairHints';

describe('buildEditFormatRepairHints', () => {
  it('ladders old_text_not_found toward exact then smaller hunks', () => {
    const hints = buildEditFormatRepairHints({
      code: 'old_text_not_found',
      path: 'src/a.ts',
      fuzzyMatchEnabled: true,
    });
    expect(hints.map((h) => h.step)).toEqual([
      'exact_old_text',
      'more_context',
      'smaller_hunk',
      'fuzzy_match',
      'full_file_replace',
    ]);
    const text = formatEditFormatRepairHints(hints);
    expect(text).toContain('apply_patch');
    expect(text).toContain('src/a.ts');
  });

  it('keeps ambiguous matches on context / replaceAll', () => {
    const hints = buildEditFormatRepairHints({
      code: 'old_text_ambiguous',
      path: 'b.ts',
    });
    expect(hints[0]?.step).toBe('more_context');
  });
});
