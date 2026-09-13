import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evaluatePreToolHooks,
  loadWorkspaceHooks,
  SAMPLE_PRE_TOOL_DENY_GIT_PUSH,
} from './workspaceHooks.js';

describe('workspaceHooks', () => {
  it('loads deny prefixes from .mitii/hooks when enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-hooks-'));
    await mkdir(join(root, '.mitii', 'hooks'), { recursive: true });
    await writeFile(
      join(root, '.mitii', 'hooks', 'deny-git-push.json'),
      JSON.stringify(SAMPLE_PRE_TOOL_DENY_GIT_PUSH),
    );

    const disabled = await loadWorkspaceHooks({
      workspaceRoot: root,
      enabled: false,
    });
    expect(disabled.specs).toHaveLength(0);

    const loaded = await loadWorkspaceHooks({
      workspaceRoot: root,
      enabled: true,
    });
    expect(loaded.denyCommandPrefixes).toContain('git push');

    const blocked = evaluatePreToolHooks({
      hooks: loaded,
      toolName: 'run_command',
      commandText: 'git push origin main',
    });
    expect(blocked.blocked).toBe(true);

    const allowed = evaluatePreToolHooks({
      hooks: loaded,
      toolName: 'run_command',
      commandText: 'git status',
    });
    expect(allowed.blocked).toBe(false);
  });
});
