import { describe, expect, it } from 'vitest';

import {
  resolveAstGrepBinary,
  resolveRipgrepBinary,
} from './resolveHostToolBinaries.js';

describe('resolveHostToolBinaries', () => {
  it('resolveRipgrepBinary returns a candidate string', () => {
    const path = resolveRipgrepBinary();
    expect(typeof path).toBe('string');
    expect(path!.length).toBeGreaterThan(0);
  });

  it('resolveAstGrepBinary returns bundled path, PATH name, or undefined', () => {
    const path = resolveAstGrepBinary();
    expect(path === undefined || typeof path === 'string').toBe(true);
  });
});
