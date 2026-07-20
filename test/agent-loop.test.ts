import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../src/features/ce/runtime/AgentLoop';
import { chunkContent } from '../src/kernel/llm/streamChunks';
import type { ToolExecutor } from '../src/features/ce/safety/ToolExecutor';
import type { LlmProvider } from '../src/kernel/llm/types';
import type { ThunderPlan } from '../src/features/ce/plans/PlanActEngine';

function mockProvider(responses: Array<Record<string, unknown>>): LlmProvider {
  let call = 0;
  return {
    id: 'mock',
    capabilities: { supportsTools: true, supportsStreaming: true, contextWindow: 8192, supportsEmbeddings: false },
    async *complete() {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (response.content) yield { content: response.content as string };
      if (response.tool_calls) yield { tool_calls: response.tool_calls as never };
      yield { done: true };
    },
  } as LlmProvider;
}

describe('AgentLoop E2E', () => {
  let executedTools: string[];

  beforeEach(() => {
    executedTools = [];
  });

  function createMockExecutor(): ToolExecutor {
    return {
      execute: vi.fn(async (name: string) => {
        executedTools.push(name);
        return { success: true, output: `ok:${name}` };
      }),
    } as unknown as ToolExecutor;
  }

  it('injects plan tracker into messages when planTracker option is set', async () => {
    const plan: ThunderPlan = {
      goal: 'Clean dependencies',
      assumptions: [],
      requiredApprovals: [],
      steps: [
        { id: 'step_1', title: 'Run audit', status: 'running', risk: 'low', phase: 'diagnostics' },
        { id: 'step_2', title: 'Remove packages', status: 'pending', risk: 'medium', dependsOn: ['step_1'] },
      ],
    };

    const provider = mockProvider([
      { content: 'Done with step.' },
    ]);

    const loop = new AgentLoop(createMockExecutor(), 5);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Execute step 1' }],
      [],
      undefined,
      undefined,
      { planTracker: plan, maxSteps: 3 }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(chunks.join('')).toContain('Done');
  });

  it('rejects a tool call for a tool not offered in this run, without invoking the executor', async () => {
    const executor = createMockExecutor();
    const provider = mockProvider([
      {
        tool_calls: [{
          index: 0,
          id: 'call_1',
          function: { name: 'mark_step_complete', arguments: '{"stepId":"current"}' },
        }],
      },
      { content: 'Done.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Fix the bug' }],
      // mark_step_complete deliberately excluded — e.g. direct Agent execution with no active plan.
      [{ type: 'function', function: { name: 'run_command', description: 'run', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 5 }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(executor.execute).not.toHaveBeenCalled();
    expect(executedTools).toEqual([]);
  });

  it('executes tool calls and stops on pending approval', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      output: '',
      pendingApproval: true,
      error: 'Awaiting approval',
    });

    const provider = mockProvider([
      {
        tool_calls: [{
          index: 0,
          id: 'call_1',
          function: { name: 'write_file', arguments: '{"path":"test.ts","content":"x"}' },
        }],
      },
      { content: 'Waiting.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    for await (const _chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Write file' }],
      [{ type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 3 }
    )) {
      // consume
    }

    expect(loop.hadPendingApproval()).toBe(true);
    expect(loop.getSuspendState()?.messages.some(
      (m) => m.role === 'tool' && m.content.includes('awaiting user approval')
    )).toBe(true);
  });

  it('executes tool calls in model order and waits before running dependent tools', async () => {
    let writeFinished = false;
    const executor = {
      execute: vi.fn(async (name: string) => {
        if (name === 'write_file') {
          await new Promise((resolve) => setTimeout(resolve, 10));
          writeFinished = true;
          return { success: true, output: 'written' };
        }
        expect(writeFinished).toBe(true);
        return { success: true, output: 'verified' };
      }),
    } as unknown as ToolExecutor;

    const provider = mockProvider([
      {
        tool_calls: [
          {
            index: 0,
            id: 'call_write',
            function: { name: 'write_file', arguments: '{"path":"README.md","content":"x"}' },
          },
          {
            index: 1,
            id: 'call_verify',
            function: { name: 'run_command', arguments: '{"command":"pnpm test"}' },
          },
        ],
      },
      { content: 'Verified.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    for await (const _chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Patch then verify' }],
      [
        { type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } },
        { type: 'function', function: { name: 'run_command', description: 'run', parameters: {} } },
      ],
      undefined,
      undefined,
      { maxSteps: 3 }
    )) {
      // consume
    }

    expect(executor.execute).toHaveBeenNthCalledWith(
      1,
      'write_file',
      expect.any(Object),
      expect.any(Object)
    );
    expect(executor.execute).toHaveBeenNthCalledWith(
      2,
      'run_command',
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('does not execute later tool calls after one tool waits for approval', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      output: '',
      pendingApproval: true,
      error: 'Awaiting approval',
    });

    const plan: ThunderPlan = {
      goal: 'Update docs',
      assumptions: [],
      requiredApprovals: [],
      steps: [{ id: 'step_1', title: 'Write docs', status: 'running', risk: 'medium' }],
    };
    const provider = mockProvider([
      {
        tool_calls: [
          {
            index: 0,
            id: 'call_write',
            function: { name: 'write_file', arguments: '{"path":"README.md","content":"x"}' },
          },
          {
            index: 1,
            id: 'call_verify',
            function: { name: 'run_command', arguments: '{"command":"pnpm test"}' },
          },
        ],
      },
      { content: 'checkpoint' },
    ]);

    const loop = new AgentLoop(executor, 5);
    for await (const _chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Write docs then verify' }],
      [
        { type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } },
        { type: 'function', function: { name: 'run_command', description: 'run', parameters: {} } },
      ],
      undefined,
      undefined,
      {
        maxSteps: 3,
        maxAutoContinues: 4,
        autoContinue: false,
        requiresWrite: true,
        requiredOperation: 'workspace_write',
        logAuditMode: true,
        askMode: true,
        requiresAskGrounding: true,
        planMode: true,
        requiresPlanGrounding: true,
        reasoningEffort: 'high',
        planTracker: plan,
      }
    )) {
      // consume
    }

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(loop.getSuspendState()?.options).toEqual(expect.objectContaining({
      autoContinue: false,
      maxAutoContinues: 4,
      requiresWrite: true,
      requiredOperation: 'workspace_write',
      logAuditMode: true,
      askMode: true,
      requiresAskGrounding: true,
      planMode: true,
      requiresPlanGrounding: true,
      reasoningEffort: 'high',
      planTracker: plan,
    }));
  });

  it('nudges agent edit tasks when the model stops before writing', async () => {
    const executor = createMockExecutor();
    const seenMessages: Array<Array<{ role: string; content: string }>> = [];
    let call = 0;
    const provider = {
      id: 'mock',
      capabilities: { supportsTools: true, supportsStreaming: true, contextWindow: 8192, supportsEmbeddings: false },
      async *complete(request: { messages: Array<{ role: string; content: string }> }) {
        seenMessages.push(request.messages);
        call += 1;
        if (call === 1) {
          yield {
            tool_calls: [{
              index: 0,
              id: 'call_read',
              function: { name: 'read_file', arguments: '{"path":"README.md"}' },
            }],
          };
        } else if (call === 2) {
          yield { content: 'I found the README and it already mentions the feature.' };
        } else if (call === 3) {
          yield {
            tool_calls: [{
              index: 0,
              id: 'call_write',
              function: { name: 'write_file', arguments: '{"path":"README.md","content":"updated"}' },
            }],
          };
        } else {
          yield { content: 'Updated README.md.' };
        }
        yield { done: true };
      },
    } as LlmProvider;

    const loop = new AgentLoop(executor, 5);
    for await (const _chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Update the README' }],
      [
        { type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } },
        { type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } },
      ],
      undefined,
      undefined,
      { maxSteps: 4, requiresWrite: true }
    )) {
      // consume
    }

    expect(executedTools).toEqual(['read_file', 'write_file']);
    expect(seenMessages[2].some(
      (m) => m.role === 'user' && m.content.includes('no file edit has been made yet')
    )).toBe(true);
  });

  it('nudges agent edit tasks that keep using read-only tools before writing', async () => {
    const executor = createMockExecutor();
    const seenMessages: Array<Array<{ role: string; content: string }>> = [];
    let call = 0;
    const provider = {
      id: 'mock',
      capabilities: { supportsTools: true, supportsStreaming: true, contextWindow: 8192, supportsEmbeddings: false },
      async *complete(request: { messages: Array<{ role: string; content: string }> }) {
        seenMessages.push(request.messages);
        call += 1;
        if (call <= 2) {
          yield {
            tool_calls: [{
              index: 0,
              id: `call_read_${call}`,
              function: { name: 'read_file', arguments: '{"path":"README.md"}' },
            }],
          };
        } else if (call === 3) {
          yield {
            tool_calls: [{
              index: 0,
              id: 'call_write',
              function: { name: 'write_file', arguments: '{"path":"README.md","content":"updated"}' },
            }],
          };
        } else {
          yield { content: 'Updated README.md.' };
        }
        yield { done: true };
      },
    } as LlmProvider;

    const loop = new AgentLoop(executor, 5);
    for await (const _chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Update the README' }],
      [
        { type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } },
        { type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } },
      ],
      undefined,
      undefined,
      { maxSteps: 5, requiresWrite: true }
    )) {
      // consume
    }

    expect(executedTools).toEqual(['read_file', 'read_file', 'write_file']);
    expect(seenMessages[2].some(
      (m) => m.role === 'user' && m.content.includes('stuck in read-only exploration')
    )).toBe(true);
  });

  it('stops edit tasks that ignore the write-required nudge', async () => {
    const executor = createMockExecutor();
    const provider = {
      id: 'mock',
      capabilities: { supportsTools: true, supportsStreaming: true, contextWindow: 8192, supportsEmbeddings: false },
      async *complete() {
        yield {
          tool_calls: [{
            index: 0,
            id: `call_read_${Math.random()}`,
            function: { name: 'read_file', arguments: '{"path":"README.md"}' },
          }],
        };
        yield { done: true };
      },
    } as LlmProvider;

    const loop = new AgentLoop(executor, 12);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Update the README' }],
      [
        { type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } },
        { type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } },
      ],
      undefined,
      undefined,
      { maxSteps: 12, requiresWrite: true }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(executor.execute).toHaveBeenCalledTimes(4);
    expect(chunks.join('')).toContain('kept using read-only tools');
  });

  it('runs independent read-only tool calls in a round concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const startOrder: string[] = [];
    const executor = {
      execute: vi.fn(async (name: string) => {
        startOrder.push(name);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return { success: true, output: `ok:${name}` };
      }),
    } as unknown as ToolExecutor;

    const provider = mockProvider([
      {
        tool_calls: [
          { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
          { index: 1, id: 'call_2', function: { name: 'search', arguments: '{"query":"foo"}' } },
          { index: 2, id: 'call_3', function: { name: 'git_diff', arguments: '{}' } },
        ],
      },
      { content: 'Done.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    for await (const _chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Explain the change' }],
      [
        { type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } },
        { type: 'function', function: { name: 'search', description: 'search', parameters: {} } },
        { type: 'function', function: { name: 'git_diff', description: 'diff', parameters: {} } },
      ],
      undefined,
      undefined,
      { maxSteps: 3 }
    )) {
      // consume
    }

    expect(startOrder).toEqual(['read_file', 'search', 'git_diff']);
    expect(maxInFlight).toBe(3);
  });

  it('falls back to sequential execution when a round mixes a write with read-only calls', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const executor = {
      execute: vi.fn(async (name: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return { success: true, output: `ok:${name}` };
      }),
    } as unknown as ToolExecutor;

    const provider = mockProvider([
      {
        tool_calls: [
          { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
          { index: 1, id: 'call_2', function: { name: 'write_file', arguments: '{"path":"a.ts","content":"x"}' } },
        ],
      },
      { content: 'Done.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    for await (const _chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Fix the file' }],
      [
        { type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } },
        { type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } },
      ],
      undefined,
      undefined,
      { maxSteps: 3 }
    )) {
      // consume
    }

    expect(maxInFlight).toBe(1);
  });

  it('does not spend the no-write budget on rounds where every tool call failed', async () => {
    let call = 0;
    const executor = {
      execute: vi.fn(async (name: string) => {
        call += 1;
        // First 4 rounds are a malformed propose_file_scope call that keeps failing with a
        // *different* input each time (so repeatedInputFailureStop's identical-failure
        // detector never fires) — this must not burn the write-required churn budget, since
        // the model never got usable results to write from.
        if (name === 'propose_file_scope' && call <= 4) {
          return { success: false, output: '', error: `Invalid input variant ${call}` };
        }
        return { success: true, output: `ok:${name}` };
      }),
    } as unknown as ToolExecutor;

    let round = 0;
    const provider = {
      id: 'mock',
      capabilities: { supportsTools: true, supportsStreaming: true, contextWindow: 8192, supportsEmbeddings: false },
      async *complete() {
        round += 1;
        if (round <= 4) {
          yield {
            tool_calls: [{
              index: 0,
              id: `call_scope_${round}`,
              function: { name: 'propose_file_scope', arguments: `{"objective":"fix","candidates":[{"path":"a${round}.ts"}]}` },
            }],
          };
        } else if (round === 5) {
          yield {
            tool_calls: [{
              index: 0,
              id: 'call_scope_ok',
              function: { name: 'propose_file_scope', arguments: '{"objective":"fix","candidates":[{"path":"a.ts"}]}' },
            }],
          };
        } else if (round === 6) {
          yield {
            tool_calls: [{
              index: 0,
              id: 'call_read',
              function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
            }],
          };
        } else if (round === 7) {
          yield {
            tool_calls: [{
              index: 0,
              id: 'call_write',
              function: { name: 'write_file', arguments: '{"path":"a.ts","content":"fixed"}' },
            }],
          };
        } else {
          yield { content: 'Fixed a.ts.' };
        }
        yield { done: true };
      },
    } as LlmProvider;

    const loop = new AgentLoop(executor, 8);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Fix the failing import' }],
      [
        { type: 'function', function: { name: 'propose_file_scope', description: 'scope', parameters: {} } },
        { type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } },
        { type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } },
      ],
      undefined,
      undefined,
      { maxSteps: 8, requiresWrite: true }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(chunks.join('')).not.toContain('kept using read-only tools');
    expect(executor.execute).toHaveBeenCalledTimes(7);
  });

  it('stops when an edit task summarizes again after the no-write nudge', async () => {
    const executor = createMockExecutor();
    let call = 0;
    const provider = {
      id: 'mock',
      capabilities: { supportsTools: true, supportsStreaming: true, contextWindow: 8192, supportsEmbeddings: false },
      async *complete() {
        call += 1;
        if (call === 1) {
          yield {
            tool_calls: [{
              index: 0,
              id: 'call_read',
              function: { name: 'read_file', arguments: '{"path":"README.md"}' },
            }],
          };
        } else if (call === 2) {
          yield { content: 'I found the Ollama config details.' };
        } else if (call === 3) {
          yield {
            tool_calls: [{
              index: 0,
              id: 'call_search',
              function: { name: 'search', arguments: '{"query":"Ollama","limit":10}' },
            }],
          };
        } else {
          yield { content: 'Here is what the README should say.' };
        }
        yield { done: true };
      },
    } as LlmProvider;

    const loop = new AgentLoop(executor, 8);
    const chunks: string[] = [];
    const candidates: Array<{ accepted: boolean; rejectionReason?: string }> = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Update the README with Ollama config details' }],
      [
        { type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } },
        { type: 'function', function: { name: 'search', description: 'search', parameters: {} } },
        { type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } },
      ],
      undefined,
      {
        onResponseCandidate: (candidate) => candidates.push(candidate),
      },
      { maxSteps: 8, requiresWrite: true }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(executedTools).toEqual(['read_file', 'search']);
    expect(chunks.join('')).toContain('tried to finish an Agent-mode edit task without calling apply_patch or write_file');
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ accepted: false, rejectionReason: 'workspace_write_required' }),
      expect.objectContaining({ accepted: false, rejectionReason: 'workspace_write_missing_after_retry' }),
    ]));
  });

  it('rejects progress-only answers for remote writes until a remote tool succeeds', async () => {
    const loop = new AgentLoop(createMockExecutor(), 4);
    const provider = mockProvider([
      { content: 'I will create the pull request now.' },
      { content: 'I am going to do that next.' },
    ]);
    const candidates: Array<{ accepted: boolean; rejectionReason?: string }> = [];
    const chunks: string[] = [];

    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Create the pull request' }],
      [{ type: 'function', function: { name: 'github_create_pull_request', description: 'create PR', parameters: {} } }],
      undefined,
      { onResponseCandidate: (candidate) => candidates.push(candidate) },
      { maxSteps: 4, requiredOperation: 'remote_write' }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(chunks.join('')).toContain('without completing the requested remote write');
    expect(candidates).toEqual([
      expect.objectContaining({ accepted: false, rejectionReason: 'remote_write_required' }),
      expect.objectContaining({ accepted: false, rejectionReason: 'remote_write_missing_after_retry' }),
    ]);
  });

  it('enforces required writes in audit mode when the route requested a workspace write', async () => {
    const loop = new AgentLoop(createMockExecutor(), 4);
    const provider = mockProvider([
      { content: 'I found unused dependency cleanup work.' },
      { content: 'Here is the cleanup summary.' },
    ]);
    const chunks: string[] = [];

    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Remove unused dependencies' }],
      [{ type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 4, auditMode: true, requiredOperation: 'workspace_write' }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(chunks.join('')).toContain('without calling apply_patch or write_file');
  });

  it('does not count skipped writes as completed required side effects', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      output: 'Skipped redundant tool call: write_file README.md',
    });

    const provider = mockProvider([
      {
        tool_calls: [{
          index: 0,
          id: 'call_write',
          function: { name: 'write_file', arguments: '{"path":"README.md","content":"x"}' },
        }],
      },
      { content: 'The README is updated.' },
      { content: 'Still done.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Update README' }],
      [{ type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 5, requiresWrite: true }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(chunks.join('')).toContain('tried to finish an Agent-mode edit task without calling apply_patch or write_file');
  });

  it('counts a successful workspace-mutating shell command as the required edit', async () => {
    const executor = createMockExecutor();
    const provider = mockProvider([
      {
        tool_calls: [{
          index: 0,
          id: 'call_restore',
          function: {
            name: 'run_command',
            arguments: '{"command":"git restore -- src/index.ts"}',
          },
        }],
      },
      { content: 'Restored src/index.ts.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Restore src/index.ts' }],
      [{ type: 'function', function: { name: 'run_command', description: 'run', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 5, requiresWrite: true, requiredOperation: 'workspace_write' }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(executedTools).toEqual(['run_command']);
    expect(chunks.join('')).toContain('Restored src/index.ts');
    expect(chunks.join('')).not.toContain('without calling apply_patch or write_file');
  });

  it('resumes with the same required-write enforcement after denied approval', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      output: '',
      pendingApproval: true,
      error: 'Awaiting approval',
    });

    const initialProvider = mockProvider([
      {
        tool_calls: [{
          index: 0,
          id: 'call_write',
          function: { name: 'write_file', arguments: '{"path":"README.md","content":"x"}' },
        }],
      },
      { content: 'checkpoint' },
    ]);

    const loop = new AgentLoop(executor, 5);
    for await (const _chunk of loop.run(
      initialProvider,
      [{ role: 'user', content: 'Update README' }],
      [{ type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 5, requiresWrite: true }
    )) {
      // consume
    }

    const state = loop.getSuspendState();
    expect(state).toBeDefined();

    const resumeProvider = mockProvider([
      { content: 'The README is updated.' },
      { content: 'Still done.' },
    ]);
    const chunks: string[] = [];
    for await (const chunk of loop.resume(
      resumeProvider,
      state!,
      [{ toolCallId: 'call_write', toolName: 'write_file', output: 'Denied', success: false }],
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(chunks.join('')).toContain('tried to finish an Agent-mode edit task without calling apply_patch or write_file');
  });

  it('hard-stops after repeated phase-blocked run_command calls', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      output: '',
      error: 'Phase 4 (Verify) allows diagnostics, lint, tests, builds, and targeted file fixes, not arbitrary shell commands.',
    });

    let call = 0;
    const provider = {
      id: 'mock',
      capabilities: { supportsTools: true, supportsStreaming: true, contextWindow: 8192, supportsEmbeddings: false },
      async *complete() {
        call += 1;
        if (call <= 2) {
          yield {
            tool_calls: [{
              index: 0,
              id: `call_${call}`,
              function: { name: 'run_command', arguments: '{"command":"node scripts/custom-mutator.js"}' },
            }],
          };
        } else {
          yield { content: 'Recovered.' };
        }
        yield { done: true };
      },
    } as LlmProvider;

    const loop = new AgentLoop(executor, 5);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Verify changes' }],
      [{ type: 'function', function: { name: 'run_command', description: 'run', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 3, phaseLock: 'verify' }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(chunks.join('')).toContain('Stopped: run_command was blocked by the current plan phase');
    expect(chunks.join('')).not.toContain('Recovered');
    expect(call).toBe(2);
  });

  it('hard-stops instead of looping when the model keeps retrying a phase-blocked write', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      output: '',
      error: 'Phase 1 (Diagnostics) is read-only; file writes are locked until Phase 3 (Execute). If analysis is complete, stop retrying writes — the orchestrator advances steps automatically.',
    });

    let call = 0;
    const provider = {
      id: 'mock',
      capabilities: { supportsTools: true, supportsStreaming: true, contextWindow: 8192, supportsEmbeddings: false },
      async *complete() {
        call += 1;
        // A weak model that never recovers — keeps calling write_file every turn.
        yield {
          tool_calls: [{
            index: 0,
            id: `call_${call}`,
            function: { name: 'write_file', arguments: '{"path":"docs/FEATURES.md","content":"x"}' },
          }],
        };
        yield { done: true };
      },
    } as LlmProvider;

    const loop = new AgentLoop(executor, 10);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Catalog features (read-only step)' }],
      [{ type: 'function', function: { name: 'write_file', description: 'write', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 10, phaseLock: 'diagnostics' }
    )) {
      chunks.push(chunkContent(chunk));
    }

    // Should stop well before exhausting maxSteps — after one nudge plus one more failed retry.
    expect(call).toBeLessThanOrEqual(3);
    expect(chunks.join('')).toContain('Stopped: file writes were blocked');
  });

  it('stops after repeated identical tool failures', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      output: '',
      error: 'MCP error -32602: Input validation error: Invalid arguments for tool write_file: expected string, received undefined',
    });

    const provider = mockProvider([
      {
        tool_calls: [{
          index: 0,
          id: 'call_1',
          function: { name: 'mcp__filesystem__write_file', arguments: '{"content":"x"}' },
        }],
      },
      {
        tool_calls: [{
          index: 0,
          id: 'call_2',
          function: { name: 'mcp__filesystem__write_file', arguments: '{"content":"x"}' },
        }],
      },
      { content: 'Should not get here.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Write file' }],
      [{ type: 'function', function: { name: 'mcp__filesystem__write_file', description: 'write', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 5 }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(chunks.join('')).toContain('Stopped after repeated identical tool failure');
    expect(chunks.join('')).not.toContain('Should not get here');
  });

  it('does not treat different command arguments with the same error as identical failures', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      output: '',
      error: 'Dangerous command blocked',
    });

    const provider = mockProvider([
      {
        tool_calls: [{
          index: 0,
          id: 'call_clean',
          function: { name: 'run_command', arguments: '{"command":"git clean -fd generated/"}' },
        }],
      },
      {
        tool_calls: [{
          index: 0,
          id: 'call_rm',
          function: { name: 'run_command', arguments: '{"command":"rm -rf generated/"}' },
        }],
      },
      { content: 'Both approaches were blocked; user approval is required.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Clean generated files' }],
      [{ type: 'function', function: { name: 'run_command', description: 'run', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 5 }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(chunks.join('')).toContain('user approval is required');
    expect(chunks.join('')).not.toContain('Stopped after repeated identical tool failure');
  });

  it('recognizes retries of the same command under different wrappers as identical failures', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      output: '',
      error: 'Command failed with exit code 2',
    });

    const provider = mockProvider([
      {
        tool_calls: [{
          index: 0,
          id: 'call_1',
          function: { name: 'run_command', arguments: '{"command":"pnpm run build"}' },
        }],
      },
      {
        tool_calls: [{
          index: 0,
          id: 'call_2',
          // Same underlying command, wrapped differently — a weak model reaching for a
          // different way to see truncated output, not a genuinely different attempt.
          function: { name: 'run_command', arguments: '{"command":"pnpm run build 2>&1 | head -120"}' },
        }],
      },
      { content: 'Should not get here.' },
    ]);

    const loop = new AgentLoop(executor, 5);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Fix the build' }],
      [{ type: 'function', function: { name: 'run_command', description: 'run', parameters: {} } }],
      undefined,
      undefined,
      { maxSteps: 5 }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(chunks.join('')).not.toContain('Should not get here');
  });

  it('narrows to write tools instead of fully disabling tools when no-progress fires on an unwritten edit task', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async (name: string) => {
      executedTools.push(name);
      if (name === 'run_command') {
        return { success: false, output: '', error: 'Command failed with exit code 2' };
      }
      return { success: true, output: `ok:${name}` };
    });

    const toolsOfferedPerCall: string[][] = [];
    const responses: Array<Record<string, unknown>> = [
      {
        tool_calls: [{
          index: 0,
          id: 'call_1',
          function: { name: 'run_command', arguments: '{"command":"pnpm run build"}' },
        }],
      },
      {
        tool_calls: [{
          index: 0,
          id: 'call_2',
          function: { name: 'run_command', arguments: '{"command":"pnpm run build 2>&1"}' },
        }],
      },
      {
        tool_calls: [{
          index: 0,
          id: 'call_3',
          function: { name: 'apply_patch', arguments: '{"path":"a.ts","oldText":"x","newText":"y"}' },
        }],
      },
      { content: 'Fixed the type error.' },
    ];
    let call = 0;
    const provider = {
      id: 'mock',
      capabilities: { supportsTools: true, supportsStreaming: true, contextWindow: 8192, supportsEmbeddings: false },
      async *complete(request: { tools: Array<{ function: { name: string } }> }) {
        toolsOfferedPerCall.push(request.tools.map((t) => t.function.name));
        const response = responses[Math.min(call, responses.length - 1)];
        call += 1;
        if (response.content) yield { content: response.content as string };
        if (response.tool_calls) yield { tool_calls: response.tool_calls as never };
        yield { done: true };
      },
    } as unknown as LlmProvider;

    const loop = new AgentLoop(executor, 6);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Fix the build error' }],
      [
        { type: 'function', function: { name: 'run_command', description: 'run', parameters: {} } },
        { type: 'function', function: { name: 'apply_patch', description: 'patch', parameters: {} } },
        { type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } },
      ],
      undefined,
      undefined,
      { maxSteps: 6, requiresWrite: true }
    )) {
      chunks.push(chunkContent(chunk));
    }

    // After 2 identical run_command failures trip no-progress, the model still has apply_patch
    // available (not fully synthesize-only) so it can act on the failures it already found.
    expect(toolsOfferedPerCall[2]).toEqual(['apply_patch']);
    expect(executedTools).toContain('apply_patch');
    expect(chunks.join('')).not.toContain('No files were changed');
    expect(chunks.join('')).not.toContain('did not change any files');
  });

  it('synthesizes gathered evidence after repeated tool failures in Ask mode', async () => {
    const executor = createMockExecutor();
    (executor.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true, output: '44 vulnerabilities found' })
      .mockResolvedValue({
        success: false,
        output: '',
        error: 'HTTP 405: Method Not Allowed',
      });

    const provider = mockProvider([
      {
        tool_calls: [{
          index: 0,
          id: 'call_audit',
          function: { name: 'execute_workspace_script', arguments: '{"script":"audit-vulnerabilities.mjs"}' },
        }],
      },
      {
        tool_calls: [{
          index: 0,
          id: 'call_web_1',
          function: { name: 'fetch_web', arguments: '{"url":"https://api.osv.dev/v1/query"}' },
        }],
      },
      {
        tool_calls: [{
          index: 0,
          id: 'call_web_2',
          function: { name: 'fetch_web', arguments: '{"url":"https://api.osv.dev/v1/query?package=fastify"}' },
        }],
      },
      { content: 'The local audit found 44 vulnerabilities; online verification failed with HTTP 405.' },
    ]);

    const loop = new AgentLoop(executor, 6);
    const chunks: string[] = [];
    for await (const chunk of loop.run(
      provider,
      [{ role: 'user', content: 'Audit vulnerabilities and verify online' }],
      [
        { type: 'function', function: { name: 'execute_workspace_script', description: 'audit', parameters: {} } },
        { type: 'function', function: { name: 'fetch_web', description: 'fetch', parameters: {} } },
      ],
      undefined,
      undefined,
      { maxSteps: 6, askMode: true }
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(executor.execute).toHaveBeenCalledTimes(3);
    expect(chunks.join('')).toContain('local audit found 44 vulnerabilities');
    expect(chunks.join('')).not.toContain('### Stopped after repeated identical tool failure');
  });

  it('resumes after approval with checkpoint injection', async () => {
    const executor = createMockExecutor();
    const provider = mockProvider([{ content: 'Resumed successfully.' }]);

    const loop = new AgentLoop(executor, 5);
    const state = {
      messages: [
        { role: 'user' as const, content: 'task' },
        { role: 'assistant' as const, content: '', tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'write_file', arguments: '{}' } }] },
        { role: 'tool' as const, tool_call_id: 'c1', name: 'write_file', content: 'awaiting approval' },
      ],
      tools: [],
      options: { maxSteps: 3 },
      checkpoint: 'Phase: execute. Completed: read package.json. Next: apply patch.',
    };

    const chunks: string[] = [];
    for await (const chunk of loop.resume(
      provider,
      state,
      [{ toolCallId: 'c1', toolName: 'write_file', output: 'written', success: true }],
    )) {
      chunks.push(chunkContent(chunk));
    }

    expect(chunks.join('')).toContain('Resumed');
  });
});

describe('Plan tools E2E', () => {
  it('requires an exact mark_step_complete stepId', async () => {
    const { createMarkStepCompleteTool } = await import('../src/features/ce/plans/tools/planTools');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const plan: ThunderPlan = {
      goal: 'test',
      assumptions: [],
      requiredApprovals: [],
      steps: [
        { id: 'step_1', title: 'Current step', status: 'running', risk: 'low' },
        { id: 'step_2', title: 'Next step', status: 'pending', risk: 'low' },
      ],
    };
    const runtime = new ToolRuntime();
    runtime.register(createMarkStepCompleteTool({
      getPlan: () => plan,
      setPlan: (updated) => {
        plan.steps = updated.steps;
      },
      getSessionId: () => 'session-1',
    }));

    const result = await runtime.execute('mark_step_complete', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid input');
    expect(plan.steps[0].status).toBe('running');
  });

  it('does not fuzzy-match mark_step_complete ids', async () => {
    const { createMarkStepCompleteTool } = await import('../src/features/ce/plans/tools/planTools');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const plan: ThunderPlan = {
      goal: 'test',
      assumptions: [],
      requiredApprovals: [],
      steps: [{ id: 'step_1', title: 'Only step', status: 'pending', risk: 'low' }],
    };
    const runtime = new ToolRuntime();
    runtime.register(createMarkStepCompleteTool({
      getPlan: () => plan,
      setPlan: (updated) => {
        plan.steps = updated.steps;
      },
      getSessionId: () => 'session-1',
    }));

    const result = await runtime.execute('mark_step_complete', { stepId: 'current' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Step not found: current');
    expect(plan.steps[0].status).toBe('pending');
  });

  it('applyDependencyLocks blocks steps until deps complete', async () => {
    const { applyDependencyLocks, getNextExecutableStep } = await import('../src/features/ce/plans/tools/planTools');
    type StepStatus = 'pending' | 'running' | 'done' | 'blocked' | 'failed' | 'blocked_by_dependency';
    const plan = {
      goal: 'test',
      assumptions: [] as string[],
      requiredApprovals: [] as string[],
      steps: [
        { id: 'a', title: 'First', status: 'pending' as StepStatus, risk: 'low' as const, dependsOn: [''] as string[] },
        { id: 'b', title: 'Second', status: 'pending' as StepStatus, risk: 'low' as const, dependsOn: ['a'] },
      ],
    };
    plan.steps[0].dependsOn = [];

    applyDependencyLocks(plan);
    expect(plan.steps[1].status).toBe('blocked_by_dependency');
    expect(getNextExecutableStep(plan)?.id).toBe('a');

    plan.steps[0].status = 'done';
    applyDependencyLocks(plan);
    expect(plan.steps[1].status).toBe('pending');
    expect(getNextExecutableStep(plan)?.id).toBe('b');
  });

  it('preserves unfinished steps when proposing a plan mutation', async () => {
    const { createProposePlanMutationTool } = await import('../src/features/ce/plans/tools/planTools');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const plan: ThunderPlan = {
      goal: 'test',
      assumptions: [],
      requiredApprovals: [],
      steps: [
        { id: 'step_1', title: 'Diagnose', status: 'done', risk: 'low' },
        { id: 'step_2', title: 'Fix auth', status: 'running', risk: 'medium' },
        { id: 'step_3', title: 'Add regression test', status: 'pending', risk: 'medium', dependsOn: ['step_2'] },
        { id: 'step_4', title: 'Verify package', status: 'pending', risk: 'low', dependsOn: ['step_3'] },
      ],
    };
    const runtime = new ToolRuntime();
    runtime.register(createProposePlanMutationTool({
      getPlan: () => plan,
      setPlan: (updated) => {
        plan.steps = updated.steps;
        plan.assumptions = updated.assumptions;
      },
      getSessionId: () => 'session-1',
    }));

    const result = await runtime.execute('propose_plan_mutation', {
      reason: 'Baseline failure revealed an auth fixture setup gap',
      newSteps: [{
        id: 'step_5',
        title: 'Repair auth fixture setup',
        phase: 'execute',
        dependsOn: ['step_1'],
        risk: 'medium',
      }],
    });

    expect(result.success).toBe(true);
    expect(plan.steps.map((step) => step.id)).toEqual(['step_1', 'step_2', 'step_3', 'step_4', 'step_5']);
    expect(plan.steps.find((step) => step.id === 'step_2')?.status).toBe('blocked');
    expect(plan.steps.find((step) => step.id === 'step_3')?.status).toBe('pending');
    expect(plan.steps.find((step) => step.id === 'step_5')?.status).toBe('running');
  });

  it('rejects plan mutations with missing dependencies', async () => {
    const { createProposePlanMutationTool } = await import('../src/features/ce/plans/tools/planTools');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const plan: ThunderPlan = {
      goal: 'test',
      assumptions: [],
      requiredApprovals: [],
      steps: [{ id: 'step_1', title: 'Diagnose', status: 'done', risk: 'low' }],
    };
    const runtime = new ToolRuntime();
    runtime.register(createProposePlanMutationTool({
      getPlan: () => plan,
      setPlan: (updated) => {
        plan.steps = updated.steps;
      },
      getSessionId: () => 'session-1',
    }));

    const result = await runtime.execute('propose_plan_mutation', {
      reason: 'Need another step',
      newSteps: [{
        id: 'step_2',
        title: 'Retry verify',
        dependsOn: ['step_that_does_not_exist'],
        risk: 'medium',
      }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('PLAN_MUTATION_MISSING_DEPENDENCY');
    expect(plan.steps).toHaveLength(1);
  });
});

describe('ImportExtractor', () => {
  it('extracts ES imports and resolves relative paths', async () => {
    const { extractImports, resolveImportTarget } = await import('../src/features/ce/indexing/ImportExtractor');
    const content = `
import { foo } from './utils';
import type { Bar } from '../types/bar';
const x = require('./legacy');
`;
    const imports = extractImports(content);
    expect(imports.length).toBeGreaterThanOrEqual(2);
    expect(resolveImportTarget('src/index.ts', './utils')).toBe('src/utils.ts');
  });
});

describe('PlanFileStore', () => {
  it('persists and loads plan.json', async () => {
    const { mkdtempSync, rmSync, readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { PlanFileStore } = await import('../src/features/ce/plans/PlanFileStore');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-plan-'));
    const store = new PlanFileStore(dir, 'task-123');
    const plan = {
      goal: 'Test goal',
      assumptions: [],
      requiredApprovals: [],
      steps: [{ id: 's1', title: 'Step 1', status: 'pending' as const, risk: 'low' as const }],
    };

    store.save(plan, 'planning');
    expect(existsSync(store.getPath())).toBe(true);

    const loaded = store.load();
    expect(loaded?.goal).toBe('Test goal');
    expect(loaded?.steps[0].status).toBe('pending');

    const updated = store.markStepComplete('s1');
    expect(updated?.steps[0].status).toBe('done');

    const onDisk = JSON.parse(readFileSync(store.getPath(), 'utf-8'));
    expect(onDisk.status).toBe('completed');

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('pageRank personalization', () => {
  it('boosts personalized nodes', async () => {
    const { computePageRank } = await import('../src/features/ce/context/pageRank');
    const personalization = new Map([
      ['hub.ts', 10],
      ['leaf.ts', 0.1],
    ]);
    const scores = computePageRank(
      ['hub.ts', 'leaf.ts', 'other.ts'],
      [{ from: 'other.ts', to: 'leaf.ts' }],
      { personalization }
    );
    expect(scores.get('hub.ts') ?? 0).toBeGreaterThan(scores.get('leaf.ts') ?? 0);
  });
});

describe('TreeSitterParser fallback', () => {
  it('extracts symbols via regex when tree-sitter unavailable', async () => {
    const { treeSitterParser } = await import('../src/features/ce/indexing/SymbolExtractor');
    const symbols = treeSitterParser.parse(`
export class MyService {
  async fetchData(): Promise<void> {}
}
export interface Config { key: string; }
`, 'typescript');
    expect(symbols.some((s) => s.name === 'MyService')).toBe(true);
  });

  it('extracts symbols via tree-sitter WASM when available', async () => {
    const { initTreeSitter, preloadWasmLanguage } = await import('../src/features/ce/indexing/TreeSitterService');
    const { extractSymbols } = await import('../src/features/ce/indexing/SymbolExtractor');
    const ready = await initTreeSitter();
    if (!ready) return;
    await preloadWasmLanguage('python');
    const symbols = extractSymbols('class Animal:\n  def speak(self): pass', 'python');
    expect(symbols.some((s) => s.name === 'Animal')).toBe(true);
    expect(symbols.some((s) => s.name === 'speak')).toBe(true);
  });
});
