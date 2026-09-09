import { describe, expect, it } from 'vitest';

import {
  isImpactOrCiOrGitPrompt,
  resolveContextToggles,
  resolveIntentLiteContextToggles,
} from '../src/contextToggles';

function config(values: Record<string, unknown> = {}) {
  return {
    get: <T>(key: string) => values[key] as T | undefined,
  };
}

describe('context toggles', () => {
  it('uses lean defaults (map/diff off; diagnostics/editor/memory on)', () => {
    const toggles = resolveContextToggles(config() as never);

    expect(toggles.memory).toBe(true);
    expect(toggles.repoMap).toBe(false);
    expect(toggles.diagnostics).toBe(true);
    expect(toggles.gitDiff).toBe(false);
    expect(toggles.editor).toBe(true);
    expect(toggles.openTabs).toBe(false);
  });

  it('honors an explicit memory disable setting', () => {
    const toggles = resolveContextToggles(
      config({ 'ui.contextToggles.memory': false }) as never,
    );

    expect(toggles.memory).toBe(false);
  });

  it('intent-lite auto-enables map/diff for CI/git impact asks', () => {
    const base = resolveContextToggles(config() as never);
    const effective = resolveIntentLiteContextToggles({
      toggles: base,
      prompt: 'Fix the failing GitHub Actions workflow',
    });

    expect(effective.repoMap).toBe(true);
    expect(effective.gitDiff).toBe(true);
    expect(effective.diagnostics).toBe(true);
  });

  it('intent-lite auto-enables map/diff for deep depth', () => {
    const base = resolveContextToggles(config() as never);
    const effective = resolveIntentLiteContextToggles({
      toggles: base,
      depth: 'deep',
      prompt: 'Implement the form builder package',
    });

    expect(effective.repoMap).toBe(true);
    expect(effective.gitDiff).toBe(true);
  });

  it('keeps map/diff off for ordinary implement asks', () => {
    expect(isImpactOrCiOrGitPrompt('Scaffold mui-builder like formik')).toBe(
      false,
    );
    const effective = resolveIntentLiteContextToggles({
      toggles: resolveContextToggles(config() as never),
      prompt: 'Scaffold mui-builder like formik',
    });
    expect(effective.repoMap).toBe(false);
    expect(effective.gitDiff).toBe(false);
  });
});
