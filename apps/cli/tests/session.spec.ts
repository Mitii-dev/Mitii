import { describe, expect, it } from 'vitest';

import { AGENT_ENGINE_SCHEMA_VERSION } from '@mitii/sdk';
import type { AgentRunResult } from '@mitii/sdk';

import {
  buildResumeInput,
  CLI_JSON_MAX_EVENTS,
  CLI_JSON_MAX_STRING_CHARS,
  serializeCliJson,
} from '../src/session.js';
import { parseCliArgs } from '../src/cli.js';

function suspendedClarification(): AgentRunResult {
  return {
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    runId: 'run_clarify',
    requestId: 'req_1',
    status: 'suspended',
    reasonCodes: ['clarification_suspended'],
    warnings: [],
    usage: {
      modelCalls: 0,
      toolCalls: 0,
      loopIterations: 0,
    },
    durationMs: 1,
    suspension: {
      kind: 'clarification_required',
      rationale: 'Need target file',
      clarificationPrompt: 'Which file?',
    },
  };
}

function suspendedApproval(): AgentRunResult {
  return {
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    runId: 'run_approve',
    requestId: 'req_2',
    status: 'suspended',
    reasonCodes: ['approval_suspended'],
    warnings: [],
    usage: {
      modelCalls: 1,
      toolCalls: 1,
      loopIterations: 1,
    },
    durationMs: 2,
    suspension: {
      kind: 'approval_required',
      rationale: 'Write requires approval',
      approval: {
        approvalId: 'appr_1',
        fingerprint: 'fp_1',
        toolName: 'apply_patch',
        callId: 'call_1',
        paths: ['src/a.ts'],
      },
    },
  };
}

function suspendedPlanApproval(): AgentRunResult {
  return {
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    runId: 'run_plan',
    requestId: 'req_3',
    status: 'suspended',
    reasonCodes: ['plan_approval_suspended'],
    warnings: [],
    usage: {
      modelCalls: 0,
      toolCalls: 0,
      loopIterations: 0,
    },
    durationMs: 3,
    suspension: {
      kind: 'plan_approval_required',
      rationale: 'A reviewable plan is required before mutation.',
    },
  };
}

describe('CLI Phase 15 session resume helpers', () => {
  it('builds clarification resume input', () => {
    const resume = buildResumeInput(suspendedClarification(), {
      kind: 'clarification',
      answer: 'src/foo.ts',
    });
    expect(resume).toEqual({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_clarify',
      clarificationAnswer: 'src/foo.ts',
    });
  });

  it('builds approval resume input for approve and deny', () => {
    expect(
      buildResumeInput(suspendedApproval(), {
        kind: 'approval',
        decision: 'approved',
      }),
    ).toEqual({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_approve',
      approval: { approvalId: 'appr_1', decision: 'approved' },
    });
    expect(
      buildResumeInput(suspendedApproval(), {
        kind: 'approval',
        decision: 'denied',
      })?.approval?.decision,
    ).toBe('denied');
  });

  it('builds plan-approval resume input for approve and reject', () => {
    expect(
      buildResumeInput(suspendedPlanApproval(), {
        kind: 'plan',
        decision: 'approved',
      }),
    ).toEqual({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_plan',
      planDecision: { decision: 'approved' },
    });
    expect(
      buildResumeInput(suspendedPlanApproval(), {
        kind: 'plan',
        decision: 'rejected',
      })?.planDecision?.decision,
    ).toBe('rejected');
  });

  it('rejects empty clarification answers', () => {
    expect(
      buildResumeInput(suspendedClarification(), {
        kind: 'clarification',
        answer: '   ',
      }),
    ).toBeNull();
  });
});

describe('CLI parseCliArgs Phase 15 flags', () => {
  it('parses clarify / approve / deny', () => {
    const clarified = parseCliArgs([
      'node',
      'mitii',
      'ask',
      'fix it',
      '--clarify',
      'src/a.ts',
    ]);
    expect(clarified.autoClarify).toBe('src/a.ts');

    const approved = parseCliArgs([
      'node',
      'mitii',
      'ask',
      'patch',
      '--approve',
    ]);
    expect(approved.autoApproval).toBe('approved');

    const denied = parseCliArgs(['node', 'mitii', 'ask', 'patch', '--deny']);
    expect(denied.autoApproval).toBe('denied');
  });
});

describe('serializeCliJson', () => {
  it('truncates long strings so --json stays bounded and parseable', () => {
    const huge = 'x'.repeat(CLI_JSON_MAX_STRING_CHARS + 500);
    const encoded = serializeCliJson({
      result: { stdout: huge, status: 'completed' },
      events: [{ type: 'stage_completed' }],
    });
    const parsed = JSON.parse(encoded) as {
      result: { stdout: string; status: string };
    };
    expect(parsed.result.status).toBe('completed');
    expect(parsed.result.stdout.length).toBeLessThan(huge.length);
    expect(parsed.result.stdout).toContain('[truncated');
    expect(encoded.length).toBeLessThan(huge.length);
  });

  it('keeps only the newest events when the trail is very long', () => {
    const events = Array.from({ length: CLI_JSON_MAX_EVENTS + 40 }, (_, i) => ({
      type: 'tool_completed',
      callId: `c${i}`,
    }));
    const encoded = serializeCliJson({
      result: { status: 'completed' },
      events,
    });
    const parsed = JSON.parse(encoded) as {
      events: unknown[];
      eventsOmitted: number;
    };
    expect(parsed.events).toHaveLength(CLI_JSON_MAX_EVENTS);
    expect(parsed.eventsOmitted).toBe(40);
    expect(JSON.parse(encoded)).toBeTruthy();
  });
});
