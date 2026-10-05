import { describe, expect, it } from 'vitest';

import {
  nextTypedLength,
  typedSlice,
} from '../src/renderer/chat/thinkingTypeReveal.js';

describe('thinkingTypeReveal', () => {
  it('advances one character when nearly caught up', () => {
    expect(nextTypedLength(10, 12)).toBe(11);
    expect(nextTypedLength(11, 12)).toBe(12);
  });

  it('catches up faster when far behind without overshooting', () => {
    const next = nextTypedLength(0, 200);
    expect(next).toBeGreaterThan(10);
    expect(next).toBeLessThanOrEqual(200);
    expect(nextTypedLength(199, 200)).toBe(200);
    expect(nextTypedLength(200, 200)).toBe(200);
  });

  it('never goes past a shorter target', () => {
    expect(nextTypedLength(40, 10)).toBe(10);
    expect(nextTypedLength(5, 0)).toBe(0);
  });

  it('slices typed text', () => {
    expect(typedSlice('abcdef', 3)).toBe('abc');
    expect(typedSlice('abcdef', 0)).toBe('');
    expect(typedSlice('abcdef', 99)).toBe('abcdef');
  });
});
