import { describe, expect, it } from 'vitest';

import {
  resolveLogVerbosity,
  resolveRunBudget,
  withCurrentApprovalPolicy,
} from '../src/hostAskSettings.js';

function fakeVs(values: Record<string, unknown> = {}) {
  return {
    workspace: {
      getConfiguration: () => ({
        get: <T>(key: string) => values[key] as T | undefined,
      }),
    },
  } as never;
}

describe('resolveRunBudget', () => {
  it('uses defaults when settings are unset', () => {
    expect(resolveRunBudget(fakeVs())).toEqual({
      maxModelCalls: 64,
      maxToolCalls: 128,
      maxLoopIterations: 96,
      maxWallTimeMs: 30 * 60 * 1000,
    });
  });

  it('floors positive values and converts minutes to ms', () => {
    const budget = resolveRunBudget(
      fakeVs({
        'runBudget.maxModelCalls': 10.9,
        'runBudget.maxToolCalls': 20,
        'runBudget.maxLoopIterations': 5,
        'runBudget.maxWallTimeMinutes': 2,
      }),
    );
    expect(budget).toEqual({
      maxModelCalls: 10,
      maxToolCalls: 20,
      maxLoopIterations: 5,
      maxWallTimeMs: 2 * 60 * 1000,
    });
  });

  it('falls back for zero, negative, non-finite, and non-number values', () => {
    const budget = resolveRunBudget(
      fakeVs({
        'runBudget.maxModelCalls': 0,
        'runBudget.maxToolCalls': -3,
        'runBudget.maxLoopIterations': Number.NaN,
        'runBudget.maxWallTimeMinutes': '5',
      }),
    );
    expect(budget.maxModelCalls).toBe(64);
    expect(budget.maxToolCalls).toBe(128);
    expect(budget.maxLoopIterations).toBe(96);
    expect(budget.maxWallTimeMs).toBe(30 * 60 * 1000);
  });

  it('returns an unlimited budget when runBudget.unlimited is set', () => {
    const budget = resolveRunBudget(
      fakeVs({ 'runBudget.unlimited': true, 'runBudget.maxModelCalls': 3 }),
    );
    expect(budget.unlimited).toBe(true);
    expect(budget.maxModelCalls).toBe(1_000_000);
    expect(budget.maxToolCalls).toBe(1_000_000);
    expect(budget.maxLoopIterations).toBe(1_000_000);
    expect(budget.maxWallTimeMs).toBe(365 * 24 * 60 * 60 * 1000);
  });
});

describe('resolveLogVerbosity', () => {
  it('defaults to verbose when unset or invalid', () => {
    expect(resolveLogVerbosity(fakeVs())).toBe('verbose');
    expect(resolveLogVerbosity(fakeVs({ logVerbosity: 'loud' }))).toBe(
      'verbose',
    );
  });

  it.each(['minimal', 'standard', 'verbose'] as const)(
    'passes through %s',
    (level) => {
      expect(resolveLogVerbosity(fakeVs({ logVerbosity: level }))).toBe(level);
    },
  );
});

describe('withCurrentApprovalPolicy', () => {
  it('overrides approvalMode from the current safety preset', () => {
    const resume = { runId: 'run_1', approvalMode: 'never' } as never;
    const out = withCurrentApprovalPolicy(
      fakeVs({ 'safety.approvalMode': 'guided' }),
      resume,
    ) as unknown as Record<string, unknown>;
    expect(out.runId).toBe('run_1');
    expect(['never', 'when_required', 'every_mutation']).toContain(
      out.approvalMode,
    );
  });
});
