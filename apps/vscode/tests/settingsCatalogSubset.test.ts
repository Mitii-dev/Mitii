import { describe, expect, it } from 'vitest';

import { SETTINGS_CATALOG } from '@mitii/settings';

import { LOOP_POLICY_FIELDS } from '../src/loopPolicySettings';
import { SETTINGS_FIELDS } from '../src/settingsFields';
import {
  CATALOG_PARENT_OBJECT_KEYS,
  assertSettingKeysInCatalog,
  resolveCatalogKey,
  settingKeysMissingFromCatalog,
  toMitiiKey,
} from '../src/settingsCatalogAssert';
import { TOKEN_BUDGET_FIELDS } from '../src/tokenBudgetSettings';
import { V8_LOOP_POLICY_FIELDS } from '../src/v8LoopPolicySettings';

describe('VS Code settings ⊆ @mitii/settings catalog', () => {
  it('maps a setting to its mitii.* key', () => {
    expect(toMitiiKey('provider.type')).toBe('mitii.provider.type');
  });

  it('allowlists mcp.enabled through the parent mitii.mcp object key', () => {
    expect(CATALOG_PARENT_OBJECT_KEYS).toEqual({ 'mcp.enabled': 'mitii.mcp' });
    expect(resolveCatalogKey('mcp.enabled')).toBe('mitii.mcp');
    expect(SETTINGS_CATALOG['mitii.mcp']).toBeTruthy();
    expect(SETTINGS_CATALOG['mitii.mcp.enabled']).toBeUndefined();
  });

  it('reports and throws for unknown settings', () => {
    expect(settingKeysMissingFromCatalog(['provider.type', 'nope.nothing'])).toEqual([
      'mitii.nope.nothing',
    ]);
    expect(() => assertSettingKeysInCatalog(['nope.nothing'])).toThrow(
      /mitii\.nope\.nothing/,
    );
    expect(() => assertSettingKeysInCatalog(['provider.type'])).not.toThrow();
  });

  it('every SETTINGS_FIELDS[].setting is in the catalog', () => {
    const settings = SETTINGS_FIELDS.map((field) => field.setting);
    expect(settings.length).toBeGreaterThan(50);
    expect(settingKeysMissingFromCatalog(settings)).toEqual([]);
    expect(() => assertSettingKeysInCatalog(settings)).not.toThrow();
  });

  it.each([
    ['tokenBudget', TOKEN_BUDGET_FIELDS],
    ['loopPolicy', LOOP_POLICY_FIELDS],
    ['v8LoopPolicy', V8_LOOP_POLICY_FIELDS],
  ] as const)('%s field keys map to mitii.%s.*', (prefix, fields) => {
    expect(fields.length).toBeGreaterThan(0);
    const settings = fields.map((field) => `${prefix}.${field.key}`);
    expect(settingKeysMissingFromCatalog(settings)).toEqual([]);
    for (const setting of settings) {
      expect(resolveCatalogKey(setting).startsWith(`mitii.${prefix}.`)).toBe(true);
    }
  });
});
