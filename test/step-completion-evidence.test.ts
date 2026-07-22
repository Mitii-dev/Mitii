import { describe, expect, it } from 'vitest';
import {
  buildStepCompletionCounters,
  evaluateStepCompletion,
  recordPlanStepToolOutcome,
} from '../src/features/ce/runtime/stepCompletionEvidence';
import { AgentTaskState } from '../src/features/ce/runtime/AgentTaskState';
import { createMarkStepCompleteTool } from '../src/features/ce/plans/tools/planTools';
import { ToolRuntime } from '../src/kernel/tools/ToolRuntime';
import type { ThunderPlan } from '../src/features/ce/plans/PlanActEngine';

describe('stepCompletionEvidence', () => {
  it('requires verification evidence for verify steps', () => {
    const step = { id: 'verify', title: 'Verify build', status: 'running' as const, risk: 'low' as const, phase: 'verify' as const };
    const counters = buildStepCompletionCounters(step, 'agent', {
      stepId: 'verify',
      successfulWrites: 0,
      successfulVerifyCommands: 0,
      failedVerifyCommands: 0,
      toolCallCount: 1,
      toolCallSuccessCount: 1,
      successfulExplicitTools: new Set(['run_command']),
    });

    const decision = evaluateStepCompletion(counters);
    expect(decision.complete).toBe(false);
    expect(decision.missing.join(' ')).toContain('verification step requires');
  });

  it('accepts passing verification commands', () => {
    const step = { id: 'verify', title: 'Verify build', status: 'running' as const, risk: 'low' as const, phase: 'verify' as const };
    const counters = buildStepCompletionCounters(step, 'agent', {
      stepId: 'verify',
      successfulWrites: 0,
      successfulVerifyCommands: 1,
      failedVerifyCommands: 0,
      toolCallCount: 1,
      toolCallSuccessCount: 1,
      successfulExplicitTools: new Set(['run_command']),
    });

    expect(evaluateStepCompletion(counters).complete).toBe(true);
  });

  it('tracks failed verification commands in step snapshots', () => {
    let snapshot = recordPlanStepToolOutcome(
      {
        successfulWrites: 0,
        successfulVerifyCommands: 0,
        failedVerifyCommands: 0,
        toolCallCount: 0,
        toolCallSuccessCount: 0,
        successfulExplicitTools: new Set<string>(),
      },
      'run_command',
      { success: false, output: 'build failed' },
      { command: 'npm run build' }
    );

    expect(snapshot.failedVerifyCommands).toBe(1);
  });
});

describe('mark_step_complete evidence gate', () => {
  it('blocks completion without step evidence', async () => {
    const plan: ThunderPlan = {
      goal: 'test',
      assumptions: [],
      requiredApprovals: [],
      steps: [{ id: 'step_1', title: 'Verify build', status: 'running', risk: 'low', phase: 'verify' }],
    };
    const taskState = new AgentTaskState();
    taskState.beginPlanStep('step_1');

    const runtime = new ToolRuntime();
    runtime.register(createMarkStepCompleteTool({
      getPlan: () => plan,
      setPlan: (updated) => {
        plan.steps = updated.steps;
      },
      getSessionId: () => 'session-1',
      getTaskState: () => taskState,
      getMode: () => 'agent',
    }));

    const result = await runtime.execute('mark_step_complete', { stepId: 'step_1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be marked complete yet');
    expect(plan.steps[0].status).toBe('running');
  });
});
