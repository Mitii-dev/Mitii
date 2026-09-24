/**
 * Deterministic step parsing + prompt mapping (enterprise pre-pipeline).
 */

import { describe, expect, it } from 'vitest';

import {
  createEmptyFlow,
  createFlowStep,
  flowFromSpecRecord,
} from '../src/shared/automations/flow.js';
import { parseStepsFromMetadata } from '../src/engine/automations/steps.js';

describe('enterprise automation steps', () => {
  it('round-trips steps through metadata desktopFlow', () => {
    const flow = createEmptyFlow({ id: 'with-steps' });
    flow.steps = [
      createFlowStep('index'),
      {
        id: 'cmd1',
        kind: 'command',
        argv: ['pnpm', 'test'],
        failOnError: true,
      },
    ];
    const metadataJson = JSON.stringify({
      desktopFlow: {
        steps: flow.steps,
        layout: flow.layout,
      },
    });
    const parsed = parseStepsFromMetadata(metadataJson);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.kind).toBe('index');
    expect(parsed[1]?.kind).toBe('command');

    const hydrated = flowFromSpecRecord({
      externalId: 'with-steps',
      title: 'With steps',
      enabled: true,
      triggerKind: 'schedule',
      scheduleExpr: '0 9 * * *',
      mode: 'ask',
      autonomyPreset: 'readonly',
      prompt: 'hi',
      metadataJson,
      sourcePath: '/tmp/.mitii/cron/with-steps.cron.md',
    });
    expect(hydrated.steps).toHaveLength(2);
    expect(hydrated.id).toBe('with-steps');
  });
});
