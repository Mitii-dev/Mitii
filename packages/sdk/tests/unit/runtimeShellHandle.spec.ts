import { describe, expect, it } from 'vitest';
import { AGENT_ENGINE_SCHEMA_VERSION } from '@mitii/v8';

import { mapRuntimeGateToSuspensionKind } from '@mitii/v8';
import { createAgentRunHandleFromRuntimeResult } from '../../src/runtimeShellHandle.js';
import { adaptResumeToRuntime } from '../../src/adaptRuntimeResume.js';

describe('mapRuntimeGateToSuspensionKind', () => {
  it('maps mutation_approval_required to approval_required', () => {
    expect(mapRuntimeGateToSuspensionKind('mutation_approval_required')).toBe(
      'approval_required',
    );
    expect(mapRuntimeGateToSuspensionKind('plan_approval_required')).toBe(
      'plan_approval_required',
    );
    expect(mapRuntimeGateToSuspensionKind('clarification_required')).toBe(
      'clarification_required',
    );
  });
});

describe('createAgentRunHandleFromRuntimeResult', () => {
  it('bridges mutation gate into AgentRunResult suspension', async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: 'r-mut',
      status: 'suspended',
      route: 'execute',
      gateKind: 'mutation_approval_required',
      reasonCodes: ['runtime_start_mutation_gate'],
    });
    const result = await handle.result;
    expect(result.status).toBe('suspended');
    expect(result.suspension?.kind).toBe('approval_required');
    expect(result.reasonCodes).toContain('approval_suspended');
    expect(result.warnings).toContain('runtime_start_mutation_gate');
  });
});

describe('adaptResumeToRuntime', () => {
  it('maps approval resume to mutation target', () => {
    const adapted = adaptResumeToRuntime({
      input: {
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: 'r1',
        approval: { approvalId: 'a1', decision: 'approved' },
      },
      fallbackMessage: 'refactor packages/v8/src/runtime',
      mode: 'agent',
    });
    expect(adapted).toMatchObject({
      decision: 'approve',
      target: 'mutation',
      message: 'refactor packages/v8/src/runtime',
      mode: 'agent',
    });
  });

  it('maps clarificationAnswer to clarify_answer', () => {
    const adapted = adaptResumeToRuntime({
      input: {
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: 'r2',
        clarificationAnswer: 'what is recursion in computer science?',
      },
      fallbackMessage: 'fix it',
      mode: 'ask',
    });
    expect(adapted.decision).toBe('clarify_answer');
    expect(adapted.clarifyAnswer).toContain('recursion');
    // Prior ask stays on message; runtime amends Clarification separately.
    expect(adapted.message).toBe('fix it');
  });
});
