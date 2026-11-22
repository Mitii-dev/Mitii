import { beforeEach, describe, expect, it, vi } from 'vitest';

const prepareStartInput = vi.hoisted(() =>
  vi.fn(async (input: Record<string, unknown>) => ({ start: input })),
);

vi.mock('@mitii/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mitii/host')>();
  return { ...actual, prepareStartInput };
});

import { buildStartInput } from '../src/engine/chat/startInput.js';
import {
  buildDesktopStartExtras,
  readDesktopSettingsJson,
} from '../src/engine/startOptions.js';

function envWith(settings: unknown): NodeJS.ProcessEnv {
  return { MITII_DESKTOP_SETTINGS_JSON: JSON.stringify(settings) };
}

describe('readDesktopSettingsJson', () => {
  it('returns undefined for missing, malformed, and non-object JSON', () => {
    expect(readDesktopSettingsJson({})).toBeUndefined();
    expect(
      readDesktopSettingsJson({ MITII_DESKTOP_SETTINGS_JSON: '{nope' }),
    ).toBeUndefined();
    expect(
      readDesktopSettingsJson({ MITII_DESKTOP_SETTINGS_JSON: '[1]' }),
    ).toBeUndefined();
  });
});

describe('buildDesktopStartExtras policy forwarding', () => {
  it('returns no extras without settings', () => {
    expect(buildDesktopStartExtras({})).toEqual({});
  });

  it('forwards numeric loopPolicy overrides only when enabled', () => {
    const on = buildDesktopStartExtras(
      envWith({
        loopPolicy: { enabled: true, maxTruncationRecoveries: 5, label: 'x' },
      }),
    );
    expect(on.loopPolicy).toEqual({ thresholds: { maxTruncationRecoveries: 5 } });

    const off = buildDesktopStartExtras(
      envWith({
        loopPolicy: { enabled: false, maxTruncationRecoveries: 5 },
      }),
    );
    expect(off.loopPolicy).toBeUndefined();
  });

  it('forwards numeric v8LoopPolicy overrides only when enabled', () => {
    const on = buildDesktopStartExtras(
      envWith({
        v8LoopPolicy: {
          enabled: true,
          toolLoopSoftIdentical: 4,
          toolLoopHardIdentical: 8,
          ignored: 'text',
        },
      }),
    );
    expect(on.v8LoopPolicy).toEqual({
      thresholds: { toolLoopSoftIdentical: 4, toolLoopHardIdentical: 8 },
    });
    expect(on.loopPolicy).toBeUndefined();

    expect(
      buildDesktopStartExtras(
        envWith({ v8LoopPolicy: { enabled: false, toolLoopSoftIdentical: 4 } }),
      ).v8LoopPolicy,
    ).toBeUndefined();
  });

  it('omits v8LoopPolicy when enabled but no numeric keys exist', () => {
    expect(
      buildDesktopStartExtras(envWith({ v8LoopPolicy: { enabled: true } }))
        .v8LoopPolicy,
    ).toBeUndefined();
  });

  it('forwards tokenBudget policy and maximumOutputTokens', () => {
    const extras = buildDesktopStartExtras(
      envWith({
        tokenBudget: { enabled: true, outputRatio: 0.25 },
        provider: { maximumOutputTokens: 4096.7 },
      }),
    );
    expect(extras.windowBudget).toEqual({
      policy: { outputRatio: 0.25 },
      maximumOutputTokens: 4096,
    });
  });
});

describe('buildStartInput', () => {
  beforeEach(() => {
    prepareStartInput.mockClear();
    vi.unstubAllEnvs();
  });

  it('passes loopPolicy and v8LoopPolicy extras into prepareStartInput', async () => {
    vi.stubEnv(
      'MITII_DESKTOP_SETTINGS_JSON',
      JSON.stringify({
        loopPolicy: { enabled: true, maxTruncationRecoveries: 5 },
        v8LoopPolicy: { enabled: true, toolLoopHardIdentical: 9 },
      }),
    );
    await buildStartInput({}, { prompt: 'hi' }, '/tmp/ws');
    expect(prepareStartInput).toHaveBeenCalledTimes(1);
    const arg = prepareStartInput.mock.calls[0]![0];
    expect(arg.loopPolicy).toEqual({ thresholds: { maxTruncationRecoveries: 5 } });
    expect(arg.v8LoopPolicy).toEqual({ thresholds: { toolLoopHardIdentical: 9 } });
  });

  it('omits v8LoopPolicy when the setting is disabled', async () => {
    vi.stubEnv(
      'MITII_DESKTOP_SETTINGS_JSON',
      JSON.stringify({ v8LoopPolicy: { enabled: false, toolLoopHardIdentical: 9 } }),
    );
    await buildStartInput({}, { prompt: 'hi' }, '/tmp/ws');
    const arg = prepareStartInput.mock.calls[0]![0];
    expect(arg).not.toHaveProperty('v8LoopPolicy');
  });
});
