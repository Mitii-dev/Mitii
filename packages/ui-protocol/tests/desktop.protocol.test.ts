import { describe, expect, it } from 'vitest';

import {
  DesktopHealthResponseSchema,
  DesktopMcpAppEventSchema,
  DesktopOllamaPullStreamLineSchema,
  DesktopPromptStreamLineSchema,
  MITII_DESKTOP_PROTOCOL,
  MITII_DESKTOP_PROTOCOL_VERSION,
  createPromptId,
  isDesktopAgentMode,
  parseDesktopCheckpointList,
  parseDesktopMemoryList,
  parseDesktopPromptBody,
  parseDesktopResumeBody,
  parseDesktopStreamLine,
} from '../src/index.js';

describe('desktop protocol identity', () => {
  it('exports stable protocol identity', () => {
    expect(MITII_DESKTOP_PROTOCOL).toBe('mitii-desktop/v1');
    expect(MITII_DESKTOP_PROTOCOL_VERSION).toBe(1);
  });

  it('validates health responses', () => {
    const ok = {
      ok: true,
      protocol: MITII_DESKTOP_PROTOCOL,
      version: 1,
      mode: 'host',
      workspaceRoot: '/w',
    };
    expect(DesktopHealthResponseSchema.safeParse(ok).success).toBe(true);
    expect(
      DesktopHealthResponseSchema.safeParse({ ...ok, version: 2 }).success,
    ).toBe(false);
    expect(
      DesktopHealthResponseSchema.safeParse({ ...ok, mode: 'other' }).success,
    ).toBe(false);
  });
});

describe('parseDesktopPromptBody', () => {
  it('accepts known modes and rejects others', () => {
    for (const mode of ['ask', 'plan', 'agent', 'database']) {
      expect(isDesktopAgentMode(mode)).toBe(true);
    }
    expect(isDesktopAgentMode('review')).toBe(false);
    expect(isDesktopAgentMode(null)).toBe(false);
  });

  it('normalizes valid bodies', () => {
    expect(
      parseDesktopPromptBody({
        prompt: '  hello  ',
        mode: 'ask',
        model: ' m ',
        sessionId: ' s ',
        id: 'p1',
      }),
    ).toEqual({
      prompt: 'hello',
      mode: 'ask',
      model: 'm',
      sessionId: 's',
      id: 'p1',
    });
  });

  it('drops malformed optionals instead of failing', () => {
    expect(
      parseDesktopPromptBody({ prompt: 'x', mode: 'review', model: 5, id: '' }),
    ).toEqual({ prompt: 'x' });
  });

  it('rejects empty prompts and non-objects', () => {
    expect(parseDesktopPromptBody({ prompt: '   ' })).toEqual({
      error: 'prompt_required',
    });
    expect(parseDesktopPromptBody({})).toEqual({ error: 'prompt_required' });
    expect(parseDesktopPromptBody(null)).toEqual({ error: 'expected_object' });
    expect(parseDesktopPromptBody([])).toEqual({ error: 'expected_object' });
  });
});

describe('parseDesktopResumeBody', () => {
  it('parses decisions and drops malformed sub-objects', () => {
    const result = parseDesktopResumeBody({
      runId: ' r1 ',
      mode: 'agent',
      approval: { approvalId: 'a', decision: 'approved' },
      grantExpansion: { expansionId: 'g', decision: 'nope' },
      continueDecision: { decision: 'continue', guidance: '  go  ' },
      clarificationAnswer: '  ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runId).toBe('r1');
      expect(result.value.mode).toBe('agent');
      expect(result.value.approval).toEqual({
        approvalId: 'a',
        decision: 'approved',
      });
      expect(result.value.grantExpansion).toBeUndefined();
      expect(result.value.continueDecision).toEqual({
        decision: 'continue',
        guidance: 'go',
      });
      expect(result.value.clarificationAnswer).toBeUndefined();
    }
  });

  it('falls back to undefined for non plan/agent modes', () => {
    const result = parseDesktopResumeBody({ runId: 'r', mode: 'database' });
    expect(result.ok && result.value.mode).toBeUndefined();
  });

  it('rejects missing runId and non-objects', () => {
    expect(parseDesktopResumeBody({ runId: '  ' })).toEqual({
      ok: false,
      error: 'runId_required',
    });
    expect(parseDesktopResumeBody('x')).toEqual({
      ok: false,
      error: 'expected_object',
    });
  });
});

describe('NDJSON stream envelope', () => {
  it('parses ready / event / result / error lines', () => {
    expect(
      parseDesktopStreamLine('{"op":"ready","id":"1","mode":"agent"}').ok,
    ).toBe(true);
    const event = parseDesktopStreamLine(
      '{"op":"event","id":"1","event":{"type":"model_delta","kind":"content","preview":"hi"}}',
    );
    expect(event.ok).toBe(true);
    if (event.ok && event.value.op === 'event') {
      expect(event.value.event.type).toBe('model_delta');
      expect(event.value.event).toMatchObject({ preview: 'hi' });
    }
    const result = parseDesktopStreamLine(
      '{"op":"result","id":"1","result":{"status":"completed","answer":"ok"}}',
    );
    expect(result.ok).toBe(true);
    expect(
      parseDesktopStreamLine('{"op":"error","error":"unauthorized"}').ok,
    ).toBe(true);
  });

  it('rejects events without a type and results without a status', () => {
    expect(
      parseDesktopStreamLine('{"op":"event","id":"1","event":{}}').ok,
    ).toBe(false);
    expect(
      parseDesktopStreamLine('{"op":"event","id":"1","event":null}').ok,
    ).toBe(false);
    expect(
      parseDesktopStreamLine('{"op":"result","id":"1","result":{}}').ok,
    ).toBe(false);
  });

  it('reports unknown ops, bad JSON and non-objects', () => {
    const unknown = parseDesktopStreamLine('{"op":"nope"}');
    expect(!unknown.ok && unknown.reason).toBe('unknown_type');
    const badJson = parseDesktopStreamLine('{not json');
    expect(!badJson.ok && badJson.issues[0]?.message).toBe('invalid_json');
    const array = parseDesktopStreamLine('[1]');
    expect(!array.ok && array.reason).toBe('expected_object');
  });

  it('validates mcp_app events', () => {
    const base = {
      type: 'mcp_app',
      at: '2026-01-01T00:00:00Z',
      mcpApp: { serverId: 's', tool: 't', title: 'x', paths: { md: 'a.md' } },
    };
    expect(DesktopMcpAppEventSchema.safeParse(base).success).toBe(true);
    expect(
      DesktopMcpAppEventSchema.safeParse({ ...base, mcpApp: { serverId: 's' } })
        .success,
    ).toBe(false);
    expect(
      DesktopPromptStreamLineSchema.safeParse({
        op: 'event',
        id: '1',
        event: base,
      }).success,
    ).toBe(true);
  });

  it('validates ollama pull lines including both done variants', () => {
    const schema = DesktopOllamaPullStreamLineSchema;
    expect(schema.safeParse({ op: 'start', model: 'm' }).success).toBe(true);
    expect(schema.safeParse({ op: 'progress', status: 's' }).success).toBe(true);
    expect(
      schema.safeParse({ op: 'done', ok: true, model: 'm' }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ op: 'done', ok: false, error: 'e' }).success,
    ).toBe(true);
    expect(schema.safeParse({ op: 'done', ok: false }).success).toBe(false);
  });
});

describe('route schemas', () => {
  it('parses memory and checkpoint lists', () => {
    expect(
      parseDesktopMemoryList({
        memories: [{ id: '1', text: 't', createdAt: 'now' }],
      }).ok,
    ).toBe(true);
    expect(parseDesktopMemoryList({ memories: [{ id: 1 }] }).ok).toBe(false);
    expect(
      parseDesktopCheckpointList({
        checkpoints: [{ id: '1', label: 'l', createdAt: 'now' }],
      }).ok,
    ).toBe(true);
    expect(parseDesktopCheckpointList({}).ok).toBe(false);
  });

  it('creates stable-ish prompt ids', () => {
    expect(createPromptId('fixed')).toBe('fixed');
    expect(createPromptId()).toMatch(/^prompt_/);
  });
});
