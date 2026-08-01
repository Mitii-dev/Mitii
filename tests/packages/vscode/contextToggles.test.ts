import { describe, expect, it } from 'vitest';

import { resolveContextToggles } from '../../../apps/vscode/src/contextToggles';

function config(values: Record<string, unknown> = {}) {
  return {
    get: <T>(key: string) => values[key] as T | undefined,
  };
}

describe('context toggles', () => {
  it('enables memory by default', () => {
    const toggles = resolveContextToggles(config() as never);

    expect(toggles.memory).toBe(true);
    expect(toggles.repoMap).toBe(true);
    expect(toggles.diagnostics).toBe(true);
    expect(toggles.gitDiff).toBe(true);
    expect(toggles.editor).toBe(true);
    expect(toggles.openTabs).toBe(false);
  });

  it('honors an explicit memory disable setting', () => {
    const toggles = resolveContextToggles(
      config({ 'ui.contextToggles.memory': false }) as never,
    );

    expect(toggles.memory).toBe(false);
  });
});
