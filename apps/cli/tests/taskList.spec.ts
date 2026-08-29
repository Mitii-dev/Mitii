import { describe, expect, it } from 'vitest';

import { AGENT_ENGINE_SCHEMA_VERSION } from '@mitii/sdk';
import type { AgentRunResult, TaskList } from '@mitii/sdk';

import { parseCliArgs } from '../src/cli.js';
import { formatTaskList } from '../src/runReport.js';
import { nextCliSessionCarry } from '../src/sessionCarry.js';

const list: TaskList = {
  schemaVersion: 1,
  source: 'agent',
  items: [
    { id: 'one', title: 'Read module', status: 'done' },
    { id: 'two', title: 'Write fix', status: 'active' },
    { id: 'three', title: 'Add test', status: 'pending' },
  ],
};

function completedResult(taskList?: TaskList): AgentRunResult {
  return {
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    runId: 'run_1',
    requestId: 'req_1',
    status: 'completed',
    answer: 'Finished the first slice.',
    reasonCodes: ['run_started'],
    warnings: [],
    usage: { modelCalls: 1, toolCalls: 1, loopIterations: 1 },
    durationMs: 4,
    ...(taskList ? { taskList } : {}),
  };
}

describe('CLI task list rendering', () => {
  it('prints checkbox progress without claiming all items are done', () => {
    const lines = formatTaskList(list);
    expect(lines[0]).toContain('1/3 complete');
    expect(lines.join('\n')).toContain('[x] Read module');
    expect(lines.join('\n')).toContain('[>] Write fix');
    expect(lines.join('\n')).toContain('[ ] Add test');
    expect(lines.join('\n')).not.toMatch(/3\/3 complete/);
  });

  it('parses --mode for ask and session', () => {
    expect(
      parseCliArgs(['node', 'mitii', 'ask', 'fix auth', '--mode', 'agent']).mode,
    ).toBe('agent');
    expect(
      parseCliArgs(['node', 'mitii', 'session', '--mode', 'plan']).mode,
    ).toBe('plan');
  });
});

describe('CLI session task carry', () => {
  it('carries the live list across agent turns without stamping remaining done', () => {
    const next = nextCliSessionCarry({
      mode: 'agent',
      conversation: [],
      prompt: 'continue',
      result: completedResult(list),
    });
    expect(next.taskList?.items.map((item) => item.status)).toEqual([
      'done',
      'active',
      'pending',
    ]);
    expect(next.conversation).toEqual([
      { role: 'user', content: 'continue' },
      { role: 'assistant', content: 'Finished the first slice.' },
    ]);
  });

  it('drops the list when agent clears it and does not carry into ask or plan', () => {
    expect(
      nextCliSessionCarry({
        mode: 'agent',
        conversation: [],
        taskList: list,
        prompt: 'all done?',
        result: completedResult(),
      }).taskList,
    ).toBeUndefined();
    expect(
      nextCliSessionCarry({
        mode: 'ask',
        conversation: [],
        taskList: list,
        prompt: 'what is 2+2?',
        result: completedResult(list),
      }).taskList,
    ).toBeUndefined();
    expect(
      nextCliSessionCarry({
        mode: 'plan',
        conversation: [],
        prompt: 'plan the change',
        result: completedResult(list),
      }).taskList,
    ).toBeUndefined();
  });
});
