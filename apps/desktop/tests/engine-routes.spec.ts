import { describe, expect, it } from 'vitest';

import { ENGINE_ROUTES, findRoute } from '../src/engine/routes/index.js';

describe('engine route table', () => {
  it('has no duplicate exact method+path entries', () => {
    const keys = ENGINE_ROUTES.filter((r) => r.path !== undefined).map(
      (r) => `${r.method} ${r.path}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves exact routes per feature', () => {
    expect(findRoute('GET', '/health')).toBeDefined();
    expect(findRoute('POST', '/v1/prompt')).toBeDefined();
    expect(findRoute('POST', '/v1/resume')).toBeDefined();
    expect(findRoute('GET', '/v1/git/status')).toBeDefined();
    expect(findRoute('GET', '/v1/workspace/tree')).toBeDefined();
    expect(findRoute('GET', '/v1/mcp')).toBeDefined();
    expect(findRoute('GET', '/v1/skills')).toBeDefined();
    expect(findRoute('GET', '/v1/profiles')).toBeDefined();
  });

  it('resolves param routes via match predicates', () => {
    expect(findRoute('DELETE', '/v1/memory/abc')).toBeDefined();
    expect(findRoute('DELETE', '/v1/checkpoints/abc')).toBeDefined();
    expect(findRoute('POST', '/v1/checkpoints/abc/restore')).toBeDefined();
  });

  it('does not match unknown routes or wrong methods', () => {
    expect(findRoute('GET', '/v1/nope')).toBeUndefined();
    expect(findRoute('DELETE', '/health')).toBeUndefined();
  });
});
