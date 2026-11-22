import { V8_ENGINE_THRESHOLDS } from '@mitii/sdk';
import { SETTINGS_CATALOG, projectNumberFields } from '@mitii/settings';
import { describe, expect, it } from 'vitest';

import { V8_LOOP_POLICY_PRESENTATION } from '../src/v8LoopPolicyFieldPresentation';
import { V8_LOOP_POLICY_FIELDS } from '../src/v8LoopPolicySettings';

const PREFIX = 'mitii.v8LoopPolicy.';

const catalogNumberKeys = Object.entries(SETTINGS_CATALOG)
  .filter(([key, entry]) => key.startsWith(PREFIX) && key !== `${PREFIX}enabled` && ['number', 'integer'].includes(entry.type as string))
  .map(([key]) => key.slice(PREFIX.length));

/** Catalog default vs SDK ship baseline; fails on any new drift. */
const KNOWN_DEFAULT_DRIFT: Record<string, { catalog: number; sdk: number }> = {};

describe('V8_LOOP_POLICY_FIELDS from the settings catalog', () => {
  it('has exactly the catalog v8LoopPolicy number keys', () => {
    expect([...V8_LOOP_POLICY_FIELDS.map((f) => f.key)].sort()).toEqual(
      [...catalogNumberKeys].sort(),
    );
    expect(V8_LOOP_POLICY_FIELDS).toHaveLength(8);
  });

  it('presentation overlay names only catalog keys and covers all of them', () => {
    expect(Object.keys(V8_LOOP_POLICY_PRESENTATION).sort()).toEqual(
      [...catalogNumberKeys].sort(),
    );
    expect(() => projectNumberFields('v8LoopPolicy', V8_LOOP_POLICY_PRESENTATION)).not.toThrow();
  });

  it('takes min/max/description from the catalog', () => {
    for (const field of V8_LOOP_POLICY_FIELDS) {
      const entry = SETTINGS_CATALOG[`${PREFIX}${field.key}`]!;
      expect(field.min, field.key).toBe(entry.minimum ?? 0);
      expect(field.max, field.key).toBe(entry.maximum);
      expect(field.description, field.key).toBe(entry.description);
    }
  });

  it('never regresses to bare short-key presentation and keeps both tiers', () => {
    for (const field of V8_LOOP_POLICY_FIELDS) {
      expect(field.label, field.key).not.toBe(field.key);
      expect(field.group.startsWith('V8 '), field.key).toBe(true);
    }
    expect(V8_LOOP_POLICY_FIELDS.filter((f) => f.tier === 'simple')).toHaveLength(4);
    expect(V8_LOOP_POLICY_FIELDS.filter((f) => f.tier === 'advanced')).toHaveLength(4);
  });

  it('uses SDK thresholds for defaultValue and tracks catalog drift', () => {
    const drift: Record<string, { catalog: number; sdk: number }> = {};
    for (const field of V8_LOOP_POLICY_FIELDS) {
      const sdk = V8_ENGINE_THRESHOLDS[field.key as keyof typeof V8_ENGINE_THRESHOLDS];
      expect(field.defaultValue, field.key).toBe(sdk);
      const catalog = SETTINGS_CATALOG[`${PREFIX}${field.key}`]!.default;
      if (catalog !== sdk) drift[field.key] = { catalog: catalog as number, sdk: sdk as number };
    }
    expect(drift).toEqual(KNOWN_DEFAULT_DRIFT);
  });
});
