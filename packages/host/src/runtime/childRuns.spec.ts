import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createChildWorktreePath,
  narrowChildStartInput,
} from './childRuns.js';

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'mitii-child-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('childRuns', () => {
  it('throws when enabled is not true', () => {
    expect(() =>
      narrowChildStartInput({
        parentMode: 'agent',
        childMode: 'ask',
        childPrompt: 'summarize',
        workspaceRoot: '/tmp/ws',
      }),
    ).toThrow(/disabled/i);

    expect(() =>
      narrowChildStartInput({
        enabled: false,
        parentMode: 'agent',
        childMode: 'ask',
        childPrompt: 'summarize',
        workspaceRoot: '/tmp/ws',
      }),
    ).toThrow(/disabled/i);
  });

  it('rejects child mode escalation above parent', () => {
    expect(() =>
      narrowChildStartInput({
        enabled: true,
        parentMode: 'ask',
        childMode: 'plan',
        childPrompt: 'plan a change',
        workspaceRoot: '/tmp/ws',
      }),
    ).toThrow(/cannot escalate/i);

    expect(() =>
      narrowChildStartInput({
        enabled: true,
        parentMode: 'plan',
        childMode: 'agent',
        childPrompt: 'implement',
        workspaceRoot: '/tmp/ws',
      }),
    ).toThrow(/cannot escalate/i);
  });

  it('allows equal-or-narrower modes and deny-only safety rules', () => {
    const narrowed = narrowChildStartInput({
      enabled: true,
      parentMode: 'agent',
      childMode: 'plan',
      childPrompt: 'draft a plan',
      workspaceRoot: '/tmp/ws',
      parentGrantDenyTools: ['delete_directory', 'run_command', 'run_command'],
    });

    expect(narrowed.mode).toBe('plan');
    expect(narrowed.prompt).toBe('draft a plan');
    expect(narrowed.userSafetyRules.enabled).toBe(true);
    expect(narrowed.userSafetyRules.denyTools).toEqual([
      'delete_directory',
      'run_command',
    ]);
    expect(JSON.stringify(narrowed)).not.toMatch(/allowedTools|ToolGrant/);
  });

  it('createChildWorktreePath mkdir under .mitii/worktrees', async () => {
    await withTempRoot(async (root) => {
      const created = await createChildWorktreePath({
        workspaceRoot: root,
        id: 'demo-child',
      });
      expect(created.id).toBe('demo-child');
      expect(created.path).toBe(join(root, '.mitii', 'worktrees', 'demo-child'));
      const info = await stat(created.path);
      expect(info.isDirectory()).toBe(true);
    });
  });
});
