import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/git/status.js', () => ({
  getGitStatus: vi.fn(async () => ({
    ok: true,
    branch: 'feat/host',
    summary: '2 files',
    files: [
      { path: 'apps/desktop/src/a.ts', status: 'M' },
      { path: 'packages/sdk/src/b.ts', status: '??' },
    ],
  })),
}));

vi.mock('../src/engine/startOptions.js', () => ({
  readDesktopSettingsJson: vi.fn(() => ({})),
  buildDesktopStartExtras: vi.fn(() => ({})),
}));

import { attachContextEnvironment } from '../src/engine/chat/startInput.js';

describe('attachContextEnvironment runtimeSituation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always attaches git + dirtyPaths for Orient even without gitDiff toggle', async () => {
    const next = await attachContextEnvironment(
      { prompt: 'fix it', mode: 'agent' },
      '/tmp/ws',
    );
    expect(next.runtimeSituation?.git?.branch).toBe('feat/host');
    expect(next.runtimeSituation?.git?.dirty).toBe(true);
    expect(next.runtimeSituation?.host?.cwd).toBe('/tmp/ws');
    expect(next.dirtyPaths).toEqual(
      expect.arrayContaining([
        'apps/desktop/src/a.ts',
        'packages/sdk/src/b.ts',
      ]),
    );
    expect(next.environment ?? []).toHaveLength(0);
  });
});
