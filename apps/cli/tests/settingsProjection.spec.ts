import { describe, expect, it } from 'vitest';

import { SETTINGS_CATALOG, catalogEntriesForPrefix } from '@mitii/settings';

import {
  CLI_CURATED_CONFIG_KEYS,
  CLI_CURATED_TO_CATALOG,
} from '../src/config.js';
import { resolveCliLoopPolicyThresholds } from '../src/loopPolicy.js';

describe('CLI curated settings projection', () => {
  it('lists the curated config keys', () => {
    expect([...CLI_CURATED_CONFIG_KEYS]).toEqual([
      'provider',
      'providerPreset',
      'model',
      'baseUrl',
      'searxngBaseUrl',
      'embeddingBackend',
      'embeddingSource',
      'embeddingModel',
      'embeddingDimensions',
      'workspaceId',
      'defaultMode',
      'contextWindowTokens',
      'loopPolicy',
    ]);
  });

  it('maps every curated key and every mapped key exists in the catalog', () => {
    expect(Object.keys(CLI_CURATED_TO_CATALOG).sort()).toEqual(
      [...CLI_CURATED_CONFIG_KEYS].sort(),
    );
    for (const [curated, target] of Object.entries(CLI_CURATED_TO_CATALOG)) {
      if (target === null) {
        expect(['embeddingBackend', 'workspaceId', 'defaultMode']).toContain(curated);
        continue;
      }
      if (target.endsWith('.*')) {
        expect(catalogEntriesForPrefix(target.slice(0, -2)).length).toBeGreaterThan(0);
      } else {
        expect(SETTINGS_CATALOG[target], `${curated} → ${target}`).toBeTruthy();
      }
    }
  });

  it('known loopPolicy UI keys are in the catalog and still accepted by the SDK schema', () => {
    const catalogKeys = new Set(
      catalogEntriesForPrefix('loopPolicy').map(({ shortKey }) => shortKey),
    );
    const known = [
      'explorationRereadMinCalls',
      'explorationRereadRatio',
      'maxExplorationStallNudges',
      'maxReadOnlyToolTurnsBeforeMutationNudge',
      'maxRejectedMutationRecoveries',
    ];
    for (const key of known) {
      expect(catalogKeys.has(key), key).toBe(true);
    }
    const thresholds = resolveCliLoopPolicyThresholds({
      config: {
        enabled: true,
        thresholds: { maxRejectedMutationRecoveries: 5 },
      },
    });
    expect(thresholds?.maxRejectedMutationRecoveries).toBe(5);
  });
});
