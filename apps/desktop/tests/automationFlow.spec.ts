/**
 * Shared automation flow helpers — unit tests (no Electron).
 */

import { describe, expect, it } from 'vitest';

import {
  applyPromptMapping,
  createEmptyFlow,
  deliveryTargetsFromFlow,
  flowFromSpecRecord,
} from '../src/shared/automations/flow.js';

describe('automationFlow', () => {
  it('creates a schedule-first empty flow', () => {
    const flow = createEmptyFlow({ id: 'demo', title: 'Demo' });
    expect(flow.schema).toBe('mitii.automation.flow/v1');
    expect(flow.trigger.kind).toBe('schedule');
    expect(flow.agent.mode).toBe('ask');
    expect(deliveryTargetsFromFlow(flow.delivery)).toEqual([]);
  });

  it('hydrates from a spec record with delivery metadata', () => {
    const flow = flowFromSpecRecord({
      externalId: 'post-commit-cover',
      title: 'Post-commit cover',
      enabled: true,
      triggerKind: 'event',
      eventType: 'github.push',
      mode: 'agent',
      autonomyPreset: 'apply_and_pr',
      prompt: 'Cover {{sha}}',
      metadataJson: JSON.stringify({
        delivery: [{ adapter: 'slack', target: 'C123' }],
        desktopFlow: {
          layout: {
            trigger: { x: 10, y: 20 },
            agent: { x: 30, y: 40 },
            delivery: {},
          },
          agent: { mapping: { sha: 'after' } },
        },
      }),
    });
    expect(flow.trigger.kind).toBe('event');
    if (flow.trigger.kind === 'event') {
      expect(flow.trigger.eventType).toBe('github.push');
    }
    expect(flow.delivery[0]?.adapter).toBe('slack');
    expect(flow.agent.mapping?.sha).toBe('after');
    expect(flow.layout.trigger.x).toBe(10);
  });

  it('applies prompt mapping from payload paths', () => {
    const out = applyPromptMapping(
      'Repo {{repository}} sha {{sha}}',
      { repository: 'repository.full_name', sha: 'after' },
      {
        repository: { full_name: 'acme/api' },
        after: 'abc123',
      },
    );
    expect(out).toBe('Repo acme/api sha abc123');
  });
});
