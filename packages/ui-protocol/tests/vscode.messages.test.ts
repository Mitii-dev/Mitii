import { describe, expect, it } from 'vitest';

import {
  HOST_TO_WEBVIEW_MESSAGE_TYPES,
  WEBVIEW_TO_HOST_MESSAGE_TYPES,
  ContextUsageNodeSchema,
  PlanViewSchema,
  parseHostToWebviewMessage,
  parseWebviewToHostMessage,
} from '../src/index.js';

describe('parseWebviewToHostMessage', () => {
  it('accepts a minimal ask message and preserves fields', () => {
    const result = parseWebviewToHostMessage({
      type: 'ask',
      prompt: 'hello',
      mode: 'agent',
      depth: 'deep',
      pinnedPaths: ['a.ts'],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        type: 'ask',
        prompt: 'hello',
        mode: 'agent',
        depth: 'deep',
        pinnedPaths: ['a.ts'],
      },
    });
  });

  it('accepts payload-less control messages', () => {
    for (const type of ['ready', 'cancel', 'newChat', 'settings.get']) {
      expect(parseWebviewToHostMessage({ type }).ok).toBe(true);
    }
  });

  it('accepts resume decisions', () => {
    const result = parseWebviewToHostMessage({
      type: 'resume',
      runId: 'r1',
      approval: { approvalId: 'a1', decision: 'approved' },
      continueDecision: { decision: 'continue', guidance: 'retry' },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a partial settings.set patch', () => {
    const result = parseWebviewToHostMessage({
      type: 'settings.set',
      provider: { model: 'gpt-x', contextWindow: 128000 },
      ui: {
        showReasoning: true,
        contextToggles: { memory: false },
        runBudget: { unlimited: true },
        modeDefaults: { ask: { depth: 'quick' } },
        tokenBudget: { enabled: true, policy: { foo: 0.5 } },
      },
      workspaceRootOverride: null,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects non-object payloads with expected_object', () => {
    for (const input of [null, undefined, 'ask', 42, ['ask']]) {
      expect(parseWebviewToHostMessage(input)).toEqual({
        ok: false,
        reason: 'expected_object',
        issues: [],
      });
    }
  });

  it('rejects unknown message types with unknown_type', () => {
    const result = parseWebviewToHostMessage({ type: 'rm -rf' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_type');
  });

  it('rejects a missing type discriminator', () => {
    const result = parseWebviewToHostMessage({ prompt: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_type');
  });

  it('rejects invalid shapes with invalid_shape and issues', () => {
    const result = parseWebviewToHostMessage({
      type: 'ask',
      prompt: 123,
      mode: 'bogus',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_shape');
      expect(result.issues.map((i) => i.path)).toEqual(
        expect.arrayContaining(['prompt', 'mode']),
      );
    }
  });

  it('rejects invalid resume decisions', () => {
    const result = parseWebviewToHostMessage({
      type: 'resume',
      runId: 'r1',
      approval: { approvalId: 'a', decision: 'maybe' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid context toggle source', () => {
    const result = parseWebviewToHostMessage({
      type: 'toggleContextSource',
      source: 'nope',
      enabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it('exposes the known type sets', () => {
    expect(WEBVIEW_TO_HOST_MESSAGE_TYPES.has('ask')).toBe(true);
    expect(WEBVIEW_TO_HOST_MESSAGE_TYPES.has('bootstrap')).toBe(false);
    expect(HOST_TO_WEBVIEW_MESSAGE_TYPES.has('bootstrap')).toBe(true);
    expect(HOST_TO_WEBVIEW_MESSAGE_TYPES.has('ask')).toBe(false);
  });
});

describe('parseHostToWebviewMessage', () => {
  it('accepts run.result with plan and usage', () => {
    const result = parseHostToWebviewMessage({
      type: 'run.result',
      status: 'completed',
      answer: 'done',
      usage: {
        modelCalls: 1,
        toolCalls: 2,
        loopIterations: 3,
        durationMs: 40,
      },
      plan: { title: 'p', steps: [{ id: '1', title: 's', status: 'done' }] },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts nullable modelPricing rates', () => {
    expect(
      parseHostToWebviewMessage({ type: 'modelPricing', rates: null }).ok,
    ).toBe(true);
  });

  it('rejects malformed run.event payloads', () => {
    const result = parseHostToWebviewMessage({
      type: 'run.event',
      event: { id: 'e', at: 'now', kind: 'tool', title: 't' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown host messages', () => {
    const result = parseHostToWebviewMessage({ type: 'ask' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_type');
  });
});

describe('shared view schemas', () => {
  it('validates recursive context usage nodes', () => {
    const node = {
      id: 'usable',
      label: 'Usable',
      usedTokens: 10,
      kind: 'usable',
      active: true,
      children: [
        { id: 'c', label: 'c', usedTokens: 1, kind: 'source', active: true },
      ],
    };
    expect(ContextUsageNodeSchema.safeParse(node).success).toBe(true);
    expect(
      ContextUsageNodeSchema.safeParse({
        ...node,
        children: [{ id: 'bad' }],
      }).success,
    ).toBe(false);
  });

  it('requires plan steps to carry a known status', () => {
    expect(
      PlanViewSchema.safeParse({
        title: 't',
        steps: [{ id: '1', title: 's', status: 'unknown' }],
      }).success,
    ).toBe(false);
  });
});
