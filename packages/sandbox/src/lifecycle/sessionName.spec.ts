import { describe, expect, it } from 'vitest';

import { buildSessionContainerName } from './sessionName.js';

describe('buildSessionContainerName', () => {
  it('is stable for the same workspace and session key', () => {
    const a = buildSessionContainerName({
      workspaceRoot: '/tmp/ws',
      sessionKey: 'run-1',
    });
    const b = buildSessionContainerName({
      workspaceRoot: '/tmp/ws',
      sessionKey: 'run-1',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^mitii-sandbox-[a-f0-9]{12}$/);
  });

  it('differs across session keys', () => {
    const a = buildSessionContainerName({
      workspaceRoot: '/tmp/ws',
      sessionKey: 'a',
    });
    const b = buildSessionContainerName({
      workspaceRoot: '/tmp/ws',
      sessionKey: 'b',
    });
    expect(a).not.toBe(b);
  });
});
