import { describe, expect, it } from 'vitest';
import { budgetDiff } from '../src/features/ce/scm/GitDiffCollector';
import { buildCommitMessagePrompt, redactSensitiveDiff } from '../src/features/ce/scm/commitMessagePrompt';
import { detectMicroTask, MicroTaskExecutor } from '../src/features/ce/microtasks';
import type { GitService } from '../src/features/ce/context/GitService';
import type { LlmProvider } from '../src/kernel/llm/types';

describe('microtasks', () => {
  it('detects supported micro-task intents', () => {
    expect(detectMicroTask('write commit message please')).toBe('commit_message');
    expect(detectMicroTask('Need commit message for the changes in stage @mitii-ai-agent')).toBe('commit_message');
    expect(detectMicroTask('suggest a subject for staged changes')).toBe('commit_message');
    expect(detectMicroTask('what changed since v1.2.0')).toBe('changelog_entry');
    expect(detectMicroTask("draft what's new")).toBe('release_notes_draft');
    expect(detectMicroTask('explain the auth flow')).toBeNull();
  });

  it('redacts sensitive diff lines in prompts', () => {
    const prompt = buildCommitMessagePrompt({
      stagedDiff: '+ API_KEY=sk-secret-value',
      unstagedDiff: '',
      changedFiles: ['M src/index.ts'],
      recentCommits: [],
      branch: 'main',
    });
    expect(prompt).toContain('[redacted sensitive line]');
    expect(prompt).not.toContain('sk-secret-value');
  });

  it('budgets large diffs by file and total caps', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      'index 111..222',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      `+${'x'.repeat(5000)}`,
      'diff --git a/b.ts b/b.ts',
      'index 333..444',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1 @@',
      '+ok',
    ].join('\n');
    const out = budgetDiff(diff, { totalMaxChars: 1000, perFileMaxChars: 200 });
    expect(out.length).toBeLessThanOrEqual(1100);
    expect(out).toContain('diff truncated');
    expect(out).toContain('diff --git a/b.ts b/b.ts');
  });

  it('runs commit-message micro-task with toolChoice none', async () => {
    const calls: unknown[] = [];
    const provider: LlmProvider = {
      id: 'fake',
      capabilities: { contextWindow: 8192, supportsEmbeddings: false, supportsStreaming: true, supportsTools: true },
      async *complete(request) {
        calls.push(request);
        yield { content: 'feat: add audit pack export' };
        yield { done: true };
      },
    };
    const git = {
      isGitRepo: true,
      getStagedDiff: async () => 'diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;',
      getUnstagedDiff: async () => '',
      getChangedFilesDetailed: async () => ['M src/a.ts'],
      getRecentCommits: async () => ['abc123 feat: old thing'],
      getCurrentBranch: async () => 'main',
    } as unknown as GitService;

    const result = await new MicroTaskExecutor({ workspace: process.cwd(), git, provider }).execute(
      'commit_message',
      'write commit message'
    );

    expect(result.content).toBe('feat: add audit pack export');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      toolChoice: 'none',
      maxTokens: 1_200,
      disableReasoning: true,
      messages: [
        expect.any(Object),
        expect.objectContaining({ content: expect.stringContaining('/no_think') }),
      ],
    });
  });

  it('retries an empty commit-message response without streaming', async () => {
    const calls: Array<{ stream?: boolean }> = [];
    let invocation = 0;
    const provider: LlmProvider = {
      id: 'fake',
      capabilities: { contextWindow: 8192, supportsEmbeddings: false, supportsStreaming: true, supportsTools: true },
      async *complete(request) {
        calls.push(request);
        invocation += 1;
        if (invocation === 2) yield { content: 'fix(scm): generate messages from staged changes' };
        yield { done: true };
      },
    };
    const git = {
      isGitRepo: true,
      getStagedDiff: async () => 'diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;',
      getUnstagedDiff: async () => '',
      getChangedFilesDetailed: async () => ['M src/a.ts'],
      getRecentCommits: async () => ['abc123 fix(scm): handle staged changes'],
      getCurrentBranch: async () => 'main',
    } as unknown as GitService;

    const result = await new MicroTaskExecutor({ workspace: process.cwd(), git, provider }).execute(
      'commit_message',
      'write commit message'
    );

    expect(result.content).toBe('fix(scm): generate messages from staged changes');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.stream).toBe(false);
  });

  it('fails instead of returning a generic message when both attempts are empty', async () => {
    const provider: LlmProvider = {
      id: 'fake',
      capabilities: { contextWindow: 8192, supportsEmbeddings: false, supportsStreaming: true, supportsTools: true },
      async *complete() {
        yield { done: true };
      },
    };
    const git = {
      isGitRepo: true,
      getStagedDiff: async () => 'diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;',
      getUnstagedDiff: async () => '',
      getChangedFilesDetailed: async () => ['M src/a.ts'],
      getRecentCommits: async () => [],
      getCurrentBranch: async () => 'main',
    } as unknown as GitService;

    await expect(new MicroTaskExecutor({ workspace: process.cwd(), git, provider }).execute(
      'commit_message',
      'write commit message'
    )).rejects.toThrow(/no valid commit message/i);
  });

  it('redacts standalone sensitive diff helper output', () => {
    expect(redactSensitiveDiff('+password=abc123')).toBe('+[redacted sensitive line]');
  });
});
