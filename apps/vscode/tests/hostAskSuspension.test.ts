import { describe, expect, it } from 'vitest';

import { AGENT_ENGINE_SCHEMA_VERSION } from '@mitii/sdk';

import {
  buildStopResumeFromSuspension,
  resultToSuspension,
} from '../src/hostAskSuspension.js';

describe('buildStopResumeFromSuspension', () => {
  it('maps continue_required stop to continueDecision', () => {
    const resume = buildStopResumeFromSuspension({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_1',
      requestId: 'req_1',
      status: 'suspended',
      reasonCodes: ['stall_continue_suspended'],
      warnings: [],
      usage: {
        modelCalls: 1,
        toolCalls: 1,
        loopIterations: 1,
      },
      durationMs: 10,
      suspension: {
        kind: 'continue_required',
        rationale: 'Stalled after re-reads.',
        continuePrompt: 'Continue or stop?',
      },
    });

    expect(resume).toEqual({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_1',
      continueDecision: { decision: 'stop' },
    });
  });

  it('maps grant expansion dismiss to denied', () => {
    const resume = buildStopResumeFromSuspension({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_2',
      requestId: 'req_2',
      status: 'suspended',
      reasonCodes: ['grant_expansion_suspended'],
      warnings: [],
      usage: {
        modelCalls: 1,
        toolCalls: 1,
        loopIterations: 1,
      },
      durationMs: 10,
      suspension: {
        kind: 'grant_expansion_required',
        grantExpansion: {
          expansionId: 'exp_1',
          extraPaths: ['packages/other'],
        },
      },
    });

    expect(resume?.grantExpansion).toEqual({
      expansionId: 'exp_1',
      decision: 'denied',
    });
  });
});

describe('resultToSuspension', () => {
  it('preserves continuePrompt for continue_required', () => {
    const payload = resultToSuspension({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_3',
      requestId: 'req_3',
      status: 'suspended',
      reasonCodes: ['stall_continue_suspended'],
      warnings: [],
      usage: {
        modelCalls: 1,
        toolCalls: 1,
        loopIterations: 1,
      },
      durationMs: 10,
      suspension: {
        kind: 'continue_required',
        rationale: 'Stalled.',
        continuePrompt: 'Keep going?',
      },
    });

    expect(payload).toMatchObject({
      runId: 'run_3',
      kind: 'continue_required',
      continuePrompt: 'Keep going?',
    });
  });
});
