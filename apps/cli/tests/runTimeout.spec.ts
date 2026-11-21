import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/parseCliArgs.js';
import { RUN_TIMEOUT_ENV, resolveRunWallTimeMs } from '../src/runTimeout.js';

describe('parseCliArgs --timeout', () => {
  it('parses seconds on ask/agent/run commands', () => {
    const agent = parseCliArgs([
      'node',
      'mitii',
      'agent',
      '--prompt',
      'fix it',
      '--timeout',
      '300',
    ]);
    expect(agent.command).toBe('agent');
    expect(agent.timeoutSeconds).toBe(300);

    const run = parseCliArgs([
      'node',
      'mitii',
      'run',
      '--auto',
      '--timeout',
      '90.5',
      'do work',
    ]);
    expect(run.timeoutSeconds).toBe(90.5);
  });

  it('leaves timeoutSeconds unset when the flag is absent', () => {
    expect(
      parseCliArgs(['node', 'mitii', 'ask', 'hi']).timeoutSeconds,
    ).toBeUndefined();
  });

  it.each(['0', '-5', 'abc'])('rejects invalid value %s', (value) => {
    const parsed = parseCliArgs(['node', 'mitii', 'ask', 'hi', '--timeout', value]);
    expect(parsed.command).toBe('error');
    expect(parsed.errorMessage).toMatch(/--timeout/);
  });

  it('requires a value', () => {
    const parsed = parseCliArgs(['node', 'mitii', 'ask', 'hi', '--timeout']);
    expect(parsed.command).toBe('error');
    expect(parsed.errorMessage).toMatch(/requires a value/);
  });
});

describe('resolveRunWallTimeMs', () => {
  it('returns no override when neither flag nor env is set', () => {
    expect(resolveRunWallTimeMs({ env: {} })).toEqual({ ok: true });
  });

  it('converts the flag to milliseconds', () => {
    expect(resolveRunWallTimeMs({ flagSeconds: 300, env: {} })).toEqual({
      ok: true,
      maxWallTimeMs: 300_000,
    });
  });

  it('falls back to the env var and lets the flag win', () => {
    const env = { [RUN_TIMEOUT_ENV]: '120' };
    expect(resolveRunWallTimeMs({ env })).toEqual({
      ok: true,
      maxWallTimeMs: 120_000,
    });
    expect(resolveRunWallTimeMs({ flagSeconds: 45, env })).toEqual({
      ok: true,
      maxWallTimeMs: 45_000,
    });
  });

  it('reports invalid env / flag values', () => {
    expect(
      resolveRunWallTimeMs({ env: { [RUN_TIMEOUT_ENV]: 'soon' } }),
    ).toMatchObject({ ok: false });
    expect(resolveRunWallTimeMs({ flagSeconds: -1, env: {} })).toMatchObject({
      ok: false,
    });
  });
});
