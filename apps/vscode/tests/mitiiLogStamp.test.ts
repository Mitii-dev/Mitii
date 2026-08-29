import { describe, expect, it } from 'vitest';

import {
  formatMitiiLogStamp,
  MITII_LOG_STAMP_PREFIX,
} from '../src/mitiiLogStamp.ts';

describe('mitiiLogStamp', () => {
  it('formats 24-hour filenames without AM/PM', () => {
    const stamp = formatMitiiLogStamp(new Date('2026-08-28T22:47:00'));
    expect(stamp).toBe('08-28-2026-22-47');
    expect(stamp).not.toMatch(/AM|PM/);
  });

  it('matches current and legacy log prefixes', () => {
    expect(
      MITII_LOG_STAMP_PREFIX.test('08-28-2026-22-47-thread_abc.jsonl'),
    ).toBe(true);
    expect(
      MITII_LOG_STAMP_PREFIX.test('08-28-2026-10-47-PM-thread_abc.jsonl'),
    ).toBe(true);
  });
});
