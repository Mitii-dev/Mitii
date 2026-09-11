import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryPipeline, MEMORY_SCHEMA_VERSION } from '@mitii/v8';

import { observeWorkspaceEvent } from './memoryCapture.js';
import {
  approvePendingMemory,
  listPendingMemories,
  rejectPendingMemory,
} from './memoryPending.js';
import { createWorkspaceMemoryStore } from './memoryStore.js';

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'mitii-pending-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('memory pending approve', () => {
  it('queues promotable drafts when autoPromote is false (default)', async () => {
    await withTempRoot(async (root) => {
      const workspaceId = 'ws-pending';
      const store = createWorkspaceMemoryStore(root, workspaceId);
      const pipeline = new MemoryPipeline({ store });

      const observed = await observeWorkspaceEvent({
        workspaceRoot: root,
        workspaceId,
        pipeline,
        toolName: 'edit',
        hookType: 'post_tool',
        userPrompt: 'Always use the shared Button component.',
        toolInput: { filePath: 'src/ui/Button.tsx' },
      });

      expect(observed.promotedMemoryId).toBeUndefined();
      expect(observed.pendingMemoryId).toBeDefined();

      const pending = await listPendingMemories(root);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.id).toBe(observed.pendingMemoryId);
      expect(pending[0]?.content).toContain('shared Button');

      const before = await pipeline.retrieve({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        query: 'button',
        scope: { kind: 'workspace', workspaceId },
      });
      expect(before.instructions).toHaveLength(0);
    });
  });

  it('approvePendingMemory commits then removes the pending row', async () => {
    await withTempRoot(async (root) => {
      const workspaceId = 'ws-approve';
      const store = createWorkspaceMemoryStore(root, workspaceId);
      const pipeline = new MemoryPipeline({ store });

      const observed = await observeWorkspaceEvent({
        workspaceRoot: root,
        workspaceId,
        pipeline,
        userPrompt: 'Prefer pnpm over npm.',
        toolName: 'edit',
        hookType: 'post_tool',
      });
      expect(observed.pendingMemoryId).toBeDefined();

      const approved = await approvePendingMemory({
        workspaceRoot: root,
        workspaceId,
        pendingId: observed.pendingMemoryId!,
        pipeline,
      });
      expect(approved.status).toBe('committed');
      expect(approved.memoryId).toBeDefined();
      expect(await listPendingMemories(root)).toHaveLength(0);

      const retrieved = await pipeline.retrieve({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        query: 'pnpm preference',
        scope: { kind: 'workspace', workspaceId },
      });
      expect(
        retrieved.instructions.some((block) => block.content.includes('pnpm')),
      ).toBe(true);
    });
  });

  it('rejectPendingMemory drops without committing', async () => {
    await withTempRoot(async (root) => {
      const workspaceId = 'ws-reject';
      const store = createWorkspaceMemoryStore(root, workspaceId);
      const pipeline = new MemoryPipeline({ store });

      const observed = await observeWorkspaceEvent({
        workspaceRoot: root,
        workspaceId,
        pipeline,
        userPrompt: 'Never commit secrets.',
        toolName: 'edit',
        hookType: 'post_tool',
      });

      const rejected = await rejectPendingMemory({
        workspaceRoot: root,
        pendingId: observed.pendingMemoryId!,
        workspaceId,
      });
      expect(rejected.rejected).toBe(true);
      expect(await listPendingMemories(root)).toHaveLength(0);

      const retrieved = await pipeline.retrieve({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        query: 'secrets',
        scope: { kind: 'workspace', workspaceId },
      });
      expect(retrieved.instructions).toHaveLength(0);
    });
  });

  it('autoPromote true still commits immediately', async () => {
    await withTempRoot(async (root) => {
      const workspaceId = 'ws-auto';
      const store = createWorkspaceMemoryStore(root, workspaceId);
      const pipeline = new MemoryPipeline({ store });

      const observed = await observeWorkspaceEvent({
        workspaceRoot: root,
        workspaceId,
        pipeline,
        autoPromote: true,
        userPrompt: 'Always run tests before push.',
        toolName: 'edit',
        hookType: 'post_tool',
      });

      expect(observed.promotedMemoryId).toBeDefined();
      expect(observed.pendingMemoryId).toBeUndefined();
      expect(await listPendingMemories(root)).toHaveLength(0);
    });
  });
});
