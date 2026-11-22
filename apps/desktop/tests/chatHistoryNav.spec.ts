import { describe, expect, it } from 'vitest';

import { formatThreadAge } from '../src/renderer/chat/threadAge.js';

describe('formatThreadAge', () => {
  const now = Date.parse('2026-10-26T18:00:00.000Z');

  it('formats minutes and hours', () => {
    expect(formatThreadAge('2026-10-26T17:58:00.000Z', now)).toBe('2m');
    expect(formatThreadAge('2026-10-26T16:00:00.000Z', now)).toBe('2h');
  });

  it('returns empty for missing or invalid', () => {
    expect(formatThreadAge(undefined, now)).toBe('');
    expect(formatThreadAge('not-a-date', now)).toBe('');
  });
});
