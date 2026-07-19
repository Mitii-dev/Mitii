import { describe, it, expect, vi } from 'vitest';
import { initialWebviewState, defaultContextToggles } from '../src/vscode/webview/messages';

describe('Webview message protocol', () => {
  it('has valid initial state', () => {
    const state = initialWebviewState();
    expect(state.tab).toBe('chat');
    expect(state.mode).toBe('plan');
    expect(state.messages).toHaveLength(0);
    expect(state.approvals).toHaveLength(0);
    expect(state.indexing.running).toBe(false);
    expect(state.settings.hasGithubToken).toBe(false);
  });

  it('has default context toggles with diagnostics off by default', () => {
    const toggles = defaultContextToggles();
    expect(toggles.repoMap).toBe(true);
    expect(toggles.fts).toBe(true);
    expect(toggles.gitDiff).toBe(true);
    expect(toggles.diagnostics).toBe(false);
    expect(toggles.memory).toBe(true);
    expect(toggles.vectors).toBe(true);
  });
});

describe('ToolExecutor', () => {
  it('requests approval for writes in plan mode', async () => {
    const { ToolExecutor } = await import('../src/features/ce/safety/ToolExecutor');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const { ToolPolicyEngine } = await import('../src/features/ce/safety/ToolPolicyEngine');
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const { defaultThunderConfig } = await import('../src/kernel/config/defaults');
    const { createWriteFileTool } = await import('../src/features/ce/tools/builtinTools');
    const { IgnoreService } = await import('../src/features/ce/indexing/IgnoreService');

    const runtime = new ToolRuntime();
    runtime.register(createWriteFileTool(process.cwd(), new IgnoreService()));

    const approvalQueue = new ApprovalQueue();
    const executor = new ToolExecutor(
      runtime,
      new ToolPolicyEngine(defaultThunderConfig().safety, () => false),
      approvalQueue,
      () => 'session-1',
      () => 'plan'
    );

    const result = await executor.execute('write_file', { path: 'test.ts', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.pendingApproval).toBe(true);
    expect(result.error).toBe('Awaiting approval');
    expect(approvalQueue.getPending()).toHaveLength(1);
    expect(approvalQueue.getPending()[0]?.toolName).toBe('write_file');
    expect(approvalQueue.getPending()[0]?.approvalKind).toBe('mode+policy');
    expect(approvalQueue.getPending()[0]?.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks dangerous commands before creating an approval request', async () => {
    const { ToolExecutor } = await import('../src/features/ce/safety/ToolExecutor');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const { ToolPolicyEngine } = await import('../src/features/ce/safety/ToolPolicyEngine');
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const { defaultThunderConfig } = await import('../src/kernel/config/defaults');
    const { createRunCommandTool } = await import('../src/features/ce/tools/builtinTools');

    const runtime = new ToolRuntime();
    runtime.register(createRunCommandTool(process.cwd(), () => 'plan'));

    const approvalQueue = new ApprovalQueue();
    const executor = new ToolExecutor(
      runtime,
      new ToolPolicyEngine({ ...defaultThunderConfig().safety, blockDangerousCommands: true }, () => false),
      approvalQueue,
      () => 'session-1',
      () => 'plan'
    );

    const result = await executor.execute('run_command', { command: 'rm -rf generated/' });
    expect(result.success).toBe(false);
    expect(result.pendingApproval).toBeUndefined();
    expect(result.error).toBe('Dangerous command blocked');
    expect(approvalQueue.getPending()).toHaveLength(0);
  });

  it('checks Ask allowlist before creating approval requests', async () => {
    const { z } = await import('zod');
    const { ToolExecutor } = await import('../src/features/ce/safety/ToolExecutor');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const { ToolPolicyEngine } = await import('../src/features/ce/safety/ToolPolicyEngine');
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const { defaultThunderConfig } = await import('../src/kernel/config/defaults');

    const runtime = new ToolRuntime();
    const execute = vi.fn(async () => ({ success: true, output: 'committed' }));
    runtime.register({
      name: 'git_commit',
      description: 'commit',
      risk: 'high',
      inputSchema: z.object({ message: z.string() }),
      execute,
    });

    const approvalQueue = new ApprovalQueue();
    const executor = new ToolExecutor(
      runtime,
      new ToolPolicyEngine(defaultThunderConfig().safety, () => false),
      approvalQueue,
      () => 'session-1',
      () => 'ask'
    );

    const result = await executor.execute('git_commit', { message: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool git_commit is not available in Ask mode');
    expect(approvalQueue.getPending()).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes approved requests by id and consumes them once', async () => {
    const { ToolExecutor } = await import('../src/features/ce/safety/ToolExecutor');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const { ToolPolicyEngine } = await import('../src/features/ce/safety/ToolPolicyEngine');
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const { defaultThunderConfig } = await import('../src/kernel/config/defaults');
    const { createWriteFileTool } = await import('../src/features/ce/tools/builtinTools');
    const { IgnoreService } = await import('../src/features/ce/indexing/IgnoreService');
    const { mkdtempSync, readFileSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const workspace = mkdtempSync(join(tmpdir(), 'mitii-approved-'));
    const runtime = new ToolRuntime();
    runtime.register(createWriteFileTool(workspace, new IgnoreService()));
    const approvalQueue = new ApprovalQueue();
    const executor = new ToolExecutor(
      runtime,
      new ToolPolicyEngine(defaultThunderConfig().safety, () => false),
      approvalQueue,
      () => 'session-1',
      () => 'plan'
    );

    const pending = await executor.execute('write_file', { path: 'approved.txt', content: 'approved' });
    expect(pending.pendingApproval).toBe(true);
    const request = approvalQueue.getPending()[0];
    expect(request).toBeDefined();
    approvalQueue.resolve(request.id, 'approved');

    const approved = await executor.executeApproved(request.id);
    expect(approved.success).toBe(true);
    expect(readFileSync(join(workspace, 'approved.txt'), 'utf8')).toBe('approved');

    const replay = await executor.executeApproved(request.id);
    expect(replay.success).toBe(false);
    expect(replay.error).toBe('Approval request is missing, expired, or already consumed.');
  });

  it('enforces offered tools inside ToolExecutor when provided by the caller', async () => {
    const { ToolExecutor } = await import('../src/features/ce/safety/ToolExecutor');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const { ToolPolicyEngine } = await import('../src/features/ce/safety/ToolPolicyEngine');
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const { defaultThunderConfig } = await import('../src/kernel/config/defaults');
    const { createRunCommandTool } = await import('../src/features/ce/tools/builtinTools');

    const runtime = new ToolRuntime();
    runtime.register(createRunCommandTool(process.cwd(), () => 'agent'));
    const executor = new ToolExecutor(
      runtime,
      new ToolPolicyEngine(defaultThunderConfig().safety, () => false),
      new ApprovalQueue(),
      () => 'session-1',
      () => 'agent'
    );

    const result = await executor.execute(
      'run_command',
      { command: 'echo ok' },
      { allowedToolNames: new Set(['read_file']) }
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool run_command was not offered for this turn');
  });
});
