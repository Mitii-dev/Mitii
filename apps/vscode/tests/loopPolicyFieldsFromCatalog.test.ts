import { AGENT_ENGINE_THRESHOLDS } from '@mitii/sdk';
import { DEFAULT_LOOP_POLICY_NUMBERS } from '@mitii/ui-core';
import {
  LOOP_POLICY_PRESENTATION,
  SETTINGS_CATALOG,
  projectNumberFields,
} from '@mitii/settings';
import { describe, expect, it } from 'vitest';

import { LOOP_POLICY_FIELDS, defaultLoopPolicySettings } from '../src/loopPolicySettings';

const PREFIX = 'mitii.loopPolicy.';

const catalogNumberKeys = Object.entries(SETTINGS_CATALOG)
  .filter(([key, entry]) => key.startsWith(PREFIX) && key !== `${PREFIX}enabled` && ['number', 'integer'].includes(entry.type as string))
  .map(([key]) => key.slice(PREFIX.length));

/** Catalog default vs SDK ship baseline; fails on any new drift. */
const KNOWN_DEFAULT_DRIFT: Record<string, { catalog: number; sdk: number }> = {
  explorationRereadMinCalls: { catalog: 8, sdk: 6 },
  maxReadOnlyToolTurnsBeforeMutationNudge: { catalog: 6, sdk: 4 },
  maxUnfulfilledExecuteRecoveries: { catalog: 1, sdk: 2 },
  defaultPreferredBatchSize: { catalog: 8, sdk: 12 },
  defaultMaxPatchesPerCall: { catalog: 16, sdk: 24 },
};

describe('LOOP_POLICY_FIELDS from the settings catalog', () => {
  it('has exactly the catalog loopPolicy number keys', () => {
    expect([...LOOP_POLICY_FIELDS.map((f) => f.key)].sort()).toEqual(
      [...catalogNumberKeys].sort(),
    );
  });

  it('presentation overlay names only catalog keys and covers all of them', () => {
    expect(Object.keys(LOOP_POLICY_PRESENTATION).sort()).toEqual(
      [...catalogNumberKeys].sort(),
    );
    expect(() => projectNumberFields('loopPolicy', LOOP_POLICY_PRESENTATION)).not.toThrow();
  });

  it('takes min/max/description from the catalog', () => {
    for (const field of LOOP_POLICY_FIELDS) {
      const entry = SETTINGS_CATALOG[`${PREFIX}${field.key}`]!;
      expect(field.min, field.key).toBe(entry.minimum ?? 0);
      expect(field.max, field.key).toBe(entry.maximum);
      expect(field.description, field.key).toBe(entry.description);
    }
  });

  it('never regresses to bare short-key presentation and keeps both tiers', () => {
    for (const field of LOOP_POLICY_FIELDS) {
      expect(field.label, field.key).not.toBe(field.key);
      expect(field.group, field.key).not.toBe('loopPolicy');
      expect(['simple', 'advanced']).toContain(field.tier);
    }
    expect(LOOP_POLICY_FIELDS.filter((f) => f.tier === 'simple')).toHaveLength(6);
    expect(LOOP_POLICY_FIELDS.filter((f) => f.tier === 'advanced').length).toBeGreaterThan(0);
  });

  it('uses SDK thresholds for defaultValue and tracks catalog drift', () => {
    const drift: Record<string, { catalog: number; sdk: number }> = {};
    for (const field of LOOP_POLICY_FIELDS) {
      const sdk = AGENT_ENGINE_THRESHOLDS[field.key as keyof typeof AGENT_ENGINE_THRESHOLDS];
      expect(field.defaultValue, field.key).toBe(sdk);
      const catalog = SETTINGS_CATALOG[`${PREFIX}${field.key}`]!.default;
      if (catalog !== sdk) drift[field.key] = { catalog: catalog as number, sdk: sdk as number };
    }
    expect(drift).toEqual(KNOWN_DEFAULT_DRIFT);
  });

  it('snapshots expose the full field set with band defaults', () => {
    const snapshot = defaultLoopPolicySettings(32_768);
    expect(snapshot.fields.map((f) => f.key)).toEqual(LOOP_POLICY_FIELDS.map((f) => f.key));
    for (const field of snapshot.fields) {
      expect(field.defaultValue, field.key).toBe(snapshot.bandThresholds[field.key]);
    }
  });

  it('ui-core DEFAULT_LOOP_POLICY_NUMBERS equals the SDK baseline for every catalog key', () => {
    expect(Object.keys(DEFAULT_LOOP_POLICY_NUMBERS).sort()).toEqual(
      [...catalogNumberKeys].sort(),
    );
    for (const key of catalogNumberKeys) {
      expect(DEFAULT_LOOP_POLICY_NUMBERS[key], key).toBe(
        AGENT_ENGINE_THRESHOLDS[key as keyof typeof AGENT_ENGINE_THRESHOLDS],
      );
    }
  });
});
