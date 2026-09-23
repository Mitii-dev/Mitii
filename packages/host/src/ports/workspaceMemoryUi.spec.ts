import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  clearWorkspaceMemories,
  commitWorkspaceMemory,
  deleteWorkspaceMemory,
  listWorkspaceMemoriesForView,
} from './workspaceMemoryUi.js';

describe('workspaceMemoryUi', () => {
  it('commits, lists, deletes, and clears memories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-mem-ui-'));
    try {
      const workspaceId = 'ws-test';
      const afterAdd = await commitWorkspaceMemory({
        workspaceRoot: root,
        workspaceId,
        content: 'Prefer pnpm over npm',
      });
      expect(afterAdd).toHaveLength(1);
      expect(afterAdd[0]?.text).toBe('Prefer pnpm over npm');

      const listed = await listWorkspaceMemoriesForView(root, workspaceId);
      expect(listed).toHaveLength(1);

      const afterDelete = await deleteWorkspaceMemory({
        workspaceRoot: root,
        workspaceId,
        id: listed[0]!.id,
      });
      expect(afterDelete).toHaveLength(0);

      await commitWorkspaceMemory({
        workspaceRoot: root,
        workspaceId,
        content: 'Use Vitest',
      });
      await clearWorkspaceMemories({ workspaceRoot: root, workspaceId });
      expect(await listWorkspaceMemoriesForView(root, workspaceId)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
