import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadMitiiHostConfig,
  saveMitiiHostConfig,
} from '../src/config.js';
import {
  formatLoopPolicySummary,
  parseLoopPolicyConfig,
  resolveCliLoopPolicyThresholds,
} from '../src/loopPolicy.js';
import { parseCliArgs } from '../src/cli.js';

describe('CLI loopPolicy config', () => {
  it('parses enabled thresholds from config objects', () => {
    const parsed = parseLoopPolicyConfig({
      enabled: true,
      thresholds: {
        maxRejectedMutationRecoveries: 5,
        explorationRereadMinCalls: 12,
      },
    });
    expect(parsed?.enabled).toBe(true);
    expect(parsed?.thresholds?.maxRejectedMutationRecoveries).toBe(5);
    expect(parsed?.thresholds?.explorationRereadMinCalls).toBe(12);
  });

  it('round-trips loopPolicy through save/load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-cli-loop-'));
    try {
      saveMitiiHostConfig(
        {
          provider: 'echo',
          loopPolicy: {
            enabled: true,
            thresholds: { maxReadOnlyToolTurnsBeforeMutationNudge: 14 },
          },
        },
        { cwd: dir },
      );
      const loaded = loadMitiiHostConfig(dir);
      expect(loaded.loopPolicy?.enabled).toBe(true);
      expect(
        loaded.loopPolicy?.thresholds?.maxReadOnlyToolTurnsBeforeMutationNudge,
      ).toBe(14);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves loopPolicy when saving unrelated fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-cli-loop-keep-'));
    try {
      saveMitiiHostConfig(
        {
          provider: 'echo',
          loopPolicy: {
            enabled: true,
            thresholds: { maxTruncationRecoveries: 4 },
          },
        },
        { cwd: dir },
      );
      saveMitiiHostConfig({ model: 'local-model' }, { cwd: dir });
      const loaded = loadMitiiHostConfig(dir);
      expect(loaded.model).toBe('local-model');
      expect(loaded.loopPolicy?.thresholds?.maxTruncationRecoveries).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveCliLoopPolicyThresholds', () => {
  it('returns undefined when custom is off', () => {
    expect(
      resolveCliLoopPolicyThresholds({
        config: {
          enabled: false,
          thresholds: { maxRejectedMutationRecoveries: 9 },
        },
      }),
    ).toBeUndefined();
  });

  it('returns config thresholds when enabled', () => {
    const resolved = resolveCliLoopPolicyThresholds({
      config: {
        enabled: true,
        thresholds: { maxRejectedMutationRecoveries: 5 },
      },
    });
    expect(resolved?.maxRejectedMutationRecoveries).toBe(5);
  });

  it('merges flag JSON over config', () => {
    const resolved = resolveCliLoopPolicyThresholds({
      config: {
        enabled: true,
        thresholds: {
          maxRejectedMutationRecoveries: 3,
          explorationRereadMinCalls: 12,
        },
      },
      flagJson: '{"maxRejectedMutationRecoveries":7}',
    });
    expect(resolved?.maxRejectedMutationRecoveries).toBe(7);
    expect(resolved?.explorationRereadMinCalls).toBe(12);
  });

  it('applies flag JSON even when config is off', () => {
    const resolved = resolveCliLoopPolicyThresholds({
      config: { enabled: false },
      flagJson: '{"maxReadOnlyMutationRetryAttempts":3}',
    });
    expect(resolved?.maxReadOnlyMutationRetryAttempts).toBe(3);
  });

  it('honors --no-loop-policy', () => {
    expect(
      resolveCliLoopPolicyThresholds({
        config: {
          enabled: true,
          thresholds: { maxRejectedMutationRecoveries: 5 },
        },
        flagJson: '{"maxRejectedMutationRecoveries":9}',
        disabled: true,
      }),
    ).toBeUndefined();
  });

  it('rejects invalid flag JSON', () => {
    expect(() =>
      resolveCliLoopPolicyThresholds({
        flagJson: '{not-json',
      }),
    ).toThrow(/valid JSON/);
  });

  it('formats summary lines', () => {
    expect(formatLoopPolicySummary(undefined)).toContain('off');
    expect(
      formatLoopPolicySummary({
        enabled: true,
        thresholds: { maxRejectedMutationRecoveries: 5 },
      }),
    ).toContain('enabled');
  });
});

describe('CLI parseCliArgs loop policy flags', () => {
  it('parses --loop-policy-json and --no-loop-policy on ask', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      'ask',
      'fix it',
      '--mode',
      'agent',
      '--loop-policy-json',
      '{"maxRejectedMutationRecoveries":5}',
      '--no-loop-policy',
    ]);
    expect(parsed.command).toBe('ask');
    expect(parsed.loopPolicyJson).toBe(
      '{"maxRejectedMutationRecoveries":5}',
    );
    expect(parsed.noLoopPolicy).toBe(true);
  });

  it('parses loop policy flags on session', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      'session',
      '--loop-policy-json',
      '{"explorationRereadMinCalls":16}',
    ]);
    expect(parsed.command).toBe('session');
    expect(parsed.loopPolicyJson).toBe(
      '{"explorationRereadMinCalls":16}',
    );
  });
});
