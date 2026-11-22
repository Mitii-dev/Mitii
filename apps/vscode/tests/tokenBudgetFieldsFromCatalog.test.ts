import { DEFAULT_WINDOW_BUDGET_POLICY } from '@mitii/sdk';
import { SETTINGS_CATALOG, projectNumberFields } from '@mitii/settings';
import { describe, expect, it } from 'vitest';

import { TOKEN_BUDGET_PRESENTATION } from '../src/tokenBudgetFieldPresentation';
import { TOKEN_BUDGET_FIELDS } from '../src/tokenBudgetSettings';

const PREFIX = 'mitii.tokenBudget.';

const catalogNumberKeys = Object.entries(SETTINGS_CATALOG)
  .filter(([key, entry]) => key.startsWith(PREFIX) && entry.type === 'number')
  .map(([key]) => key.slice(PREFIX.length));

/**
 * Catalog default vs SDK ship baseline. The host shows the SDK baseline as
 * `defaultValue`; the catalog is intentionally not rewritten in this wave.
 * Remove an entry when the catalog is aligned; the test fails on any new drift.
 */
const KNOWN_DEFAULT_DRIFT: Record<string, { catalog: number; sdk: number }> = {
  outputRatio: { catalog: 0.1, sdk: 0.2 },
  outputMinTokens: { catalog: 1024, sdk: 10240 },
  outputWindowCapRatio: { catalog: 0.2, sdk: 0.35 },
  visiblePlanMinUsableTokens: { catalog: 40000, sdk: 8192 },
  changeImpactMinUsableTokens: { catalog: 40000, sdk: 8192 },
  maxSkillsBase: { catalog: 1, sdk: 2 },
  maxSkillsPerUsable: { catalog: 30000, sdk: 12000 },
};

describe('TOKEN_BUDGET_FIELDS from the settings catalog', () => {
  it('has exactly the catalog tokenBudget number keys', () => {
    expect([...TOKEN_BUDGET_FIELDS.map((f) => f.key)].sort()).toEqual(
      [...catalogNumberKeys].sort(),
    );
    expect(TOKEN_BUDGET_FIELDS).toHaveLength(108);
  });

  it('presentation overlay names only catalog keys and covers all of them', () => {
    expect(Object.keys(TOKEN_BUDGET_PRESENTATION).sort()).toEqual(
      [...catalogNumberKeys].sort(),
    );
    expect(() =>
      projectNumberFields('tokenBudget', TOKEN_BUDGET_PRESENTATION),
    ).not.toThrow();
  });

  it('takes min/max/description from the catalog', () => {
    for (const field of TOKEN_BUDGET_FIELDS) {
      const entry = SETTINGS_CATALOG[`${PREFIX}${field.key}`]!;
      expect(field.min, field.key).toBe(entry.minimum ?? 0);
      expect(field.max, field.key).toBe(entry.maximum);
      expect(field.description, field.key).toBe(entry.description);
    }
  });

  it('never regresses to bare short-key presentation', () => {
    for (const field of TOKEN_BUDGET_FIELDS) {
      expect(field.label, field.key).not.toBe(field.key);
      expect(field.group, field.key).not.toBe('tokenBudget');
    }
    const ints = TOKEN_BUDGET_FIELDS.filter((f) => f.kind === 'int');
    expect(ints.length).toBeGreaterThan(40);
    expect(TOKEN_BUDGET_FIELDS.find((f) => f.key === 'outputMinTokens')).toMatchObject({
      group: 'Output reserve',
      label: 'Output minimum',
      kind: 'int',
      step: 256,
    });
    expect(
      TOKEN_BUDGET_FIELDS.filter((f) => f.hiddenFromDebug).map((f) => f.key),
    ).toEqual(['maxModelCallsPerUsable', 'maxModelCallsMin', 'maxModelCallsMax']);
    expect(
      TOKEN_BUDGET_FIELDS.filter((f) => f.tier === 'simple').map((f) => f.key),
    ).toEqual(['outputRatio', 'repositoryShare', 'conversationShare', 'planShare', 'skillsShare']);
  });

  it('uses the SDK ship baseline for defaultValue and tracks catalog drift', () => {
    const drift: Record<string, { catalog: number; sdk: number }> = {};
    for (const field of TOKEN_BUDGET_FIELDS) {
      const sdk = DEFAULT_WINDOW_BUDGET_POLICY[field.key as keyof typeof DEFAULT_WINDOW_BUDGET_POLICY];
      expect(field.defaultValue, field.key).toBe(sdk);
      const catalog = SETTINGS_CATALOG[`${PREFIX}${field.key}`]!.default;
      if (catalog !== sdk) drift[field.key] = { catalog: catalog as number, sdk: sdk as number };
    }
    expect(drift).toEqual(KNOWN_DEFAULT_DRIFT);
  });
});
