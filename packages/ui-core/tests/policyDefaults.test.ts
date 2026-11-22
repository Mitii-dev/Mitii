import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOOP_POLICY_NUMBERS,
  DEFAULT_V8_LOOP_POLICY_NUMBERS,
} from '../src/index.js';

describe('policy default baselines', () => {
  it('loopPolicy baseline covers every loop threshold with finite numbers', () => {
    expect(Object.keys(DEFAULT_LOOP_POLICY_NUMBERS)).toHaveLength(20);
    for (const [key, value] of Object.entries(DEFAULT_LOOP_POLICY_NUMBERS)) {
      expect(Number.isFinite(value), key).toBe(true);
    }
  });

  it('pins the SDK-aligned values that differ from the catalog', () => {
    expect(DEFAULT_LOOP_POLICY_NUMBERS.explorationRereadMinCalls).toBe(6);
    expect(DEFAULT_LOOP_POLICY_NUMBERS.maxReadOnlyToolTurnsBeforeMutationNudge).toBe(4);
    expect(DEFAULT_LOOP_POLICY_NUMBERS.maxUnfulfilledExecuteRecoveries).toBe(2);
    expect(DEFAULT_LOOP_POLICY_NUMBERS.defaultPreferredBatchSize).toBe(12);
    expect(DEFAULT_LOOP_POLICY_NUMBERS.defaultMaxPatchesPerCall).toBe(24);
  });

  it('v8LoopPolicy baseline has the eight V8 knobs', () => {
    expect(Object.keys(DEFAULT_V8_LOOP_POLICY_NUMBERS).sort()).toEqual(
      [
        'maxContinueOverrides',
        'maxReadOnlyTurnsBeforeMutationNudge',
        'maxReasoningCharsWithoutProgress',
        'maxTruncationRecoveries',
        'maxUnfulfilledExecuteRecoveries',
        'preferredBatchSize',
        'toolLoopHardIdentical',
        'toolLoopSoftIdentical',
      ].sort(),
    );
    expect(DEFAULT_V8_LOOP_POLICY_NUMBERS.toolLoopHardIdentical).toBe(6);
  });
});
