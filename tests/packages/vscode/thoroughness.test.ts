import { describe, expect, it } from 'vitest';

import {
  inferThoroughness,
  normalizeIntensitySettings,
  resolveRunIntensity,
  resolveThoroughnessPreset,
  thoroughnessFromDepth,
  thoroughnessUiPatch,
} from '../../../apps/vscode/src/thoroughness';

describe('thoroughness presets', () => {
  it('maps low/medium/high to depth + effort pairs', () => {
    expect(resolveThoroughnessPreset('low')).toEqual({
      depth: 'quick',
      effort: 'low',
    });
    expect(resolveThoroughnessPreset('medium')).toEqual({
      depth: 'auto',
      effort: 'medium',
    });
    expect(resolveThoroughnessPreset('high')).toEqual({
      depth: 'deep',
      effort: 'high',
    });
  });

  it('infers thoroughness only when depth and effort match a preset', () => {
    expect(inferThoroughness('quick', 'low')).toBe('low');
    expect(inferThoroughness('auto', 'medium')).toBe('medium');
    expect(inferThoroughness('deep', 'high')).toBe('high');
    expect(inferThoroughness('quick', 'high')).toBeUndefined();
    expect(inferThoroughness('deep', 'low')).toBeUndefined();
  });

  it('migrates legacy depth-only settings', () => {
    expect(thoroughnessFromDepth('quick')).toBe('low');
    expect(thoroughnessFromDepth('auto')).toBe('medium');
    expect(thoroughnessFromDepth('deep')).toBe('high');
  });
});

describe('resolveRunIntensity', () => {
  it('uses the clubbed preset when overrides are off', () => {
    expect(
      resolveRunIntensity({
        intensityOverrides: false,
        thoroughness: 'high',
        depth: 'quick',
        effort: 'low',
      }),
    ).toEqual({
      depth: 'deep',
      effort: 'high',
      thoroughness: 'high',
      custom: false,
    });
  });

  it('keeps orthogonal depth and effort when overrides are on', () => {
    expect(
      resolveRunIntensity({
        intensityOverrides: true,
        thoroughness: 'medium',
        depth: 'quick',
        effort: 'high',
      }),
    ).toEqual({
      depth: 'quick',
      effort: 'high',
      thoroughness: 'medium',
      custom: true,
    });
  });
});

describe('thoroughnessUiPatch', () => {
  it('clears overrides and writes depth + effort for the mode', () => {
    expect(
      thoroughnessUiPatch({ mode: 'plan', thoroughness: 'low' }),
    ).toEqual({
      intensityOverrides: false,
      effort: 'low',
      modeDefaults: {
        plan: { thoroughness: 'low', depth: 'quick' },
      },
    });
  });
});

describe('normalizeIntensitySettings', () => {
  it('fills thoroughness from depth when missing and keeps clubbed depths', () => {
    const result = normalizeIntensitySettings({
      effort: 'medium',
      intensityOverrides: false,
      modeDefaults: {
        ask: { depth: 'auto', approvalMode: 'guided', model: '' },
        plan: { depth: 'deep', approvalMode: 'guided', model: '' },
        agent: { depth: 'auto', approvalMode: 'safe', model: '' },
      },
    });

    expect(result.intensityOverrides).toBe(false);
    expect(result.modeDefaults.ask.thoroughness).toBe('medium');
    expect(result.modeDefaults.plan.thoroughness).toBe('high');
    expect(result.modeDefaults.plan.depth).toBe('deep');
    expect(result.modeDefaults.agent.depth).toBe('auto');
  });

  it('does not force overrides when legacy global effort disagrees with a mode depth', () => {
    const result = normalizeIntensitySettings({
      effort: 'medium',
      intensityOverrides: false,
      modeDefaults: {
        ask: { depth: 'auto', approvalMode: 'guided', model: '' },
        plan: { depth: 'deep', approvalMode: 'guided', model: '' },
        agent: { depth: 'auto', approvalMode: 'safe', model: '' },
      },
    });

    expect(result.intensityOverrides).toBe(false);
    expect(result.modeDefaults.plan.thoroughness).toBe('high');
    expect(result.modeDefaults.plan.depth).toBe('deep');
    expect(result.effort).toBe('medium');
  });

  it('preserves orthogonal depth when intensity overrides are already on', () => {
    const result = normalizeIntensitySettings({
      effort: 'high',
      intensityOverrides: true,
      modeDefaults: {
        ask: { depth: 'quick', approvalMode: 'guided', model: '' },
        plan: { depth: 'deep', approvalMode: 'guided', model: '' },
        agent: { depth: 'auto', approvalMode: 'safe', model: '' },
      },
    });

    expect(result.intensityOverrides).toBe(true);
    expect(result.modeDefaults.ask.depth).toBe('quick');
    expect(result.effort).toBe('high');
  });
});
