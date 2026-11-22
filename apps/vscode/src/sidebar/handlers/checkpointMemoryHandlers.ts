import { loadDiskSkills } from '@mitii/host';
import type { SkillDescriptor } from '@mitii/sdk';

import { loadCheckpoints, saveCheckpoints } from '../../chatHistory.js';
import {
  clearMemoriesForWorkspace,
  commitMemoryForWorkspace,
  deleteMemoryForWorkspace,
} from '../../memoryStore.js';
import type { WebviewToHostMessage } from '../../protocol.js';
import type { SidebarContext } from '../context.js';

export async function handleRestoreCheckpoint(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'restoreCheckpoint' }>,
): Promise<void> {
  void ctx.vs.window.showInformationMessage(
    `Mitii: Checkpoint restore for ${message.id} is recorded. Full V8 restore lands when checkpoint APIs are exposed on the SDK.`,
  );
}

export async function handleDeleteCheckpoint(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'deleteCheckpoint' }>,
): Promise<void> {
  const checkpoints = loadCheckpoints(ctx.host.workspaceState).filter(
    (c) => c.id !== message.id,
  );
  await saveCheckpoints(ctx.host.workspaceState, checkpoints);
  ctx.post({ type: 'setCheckpoints', checkpoints });
}

export async function handleClearCheckpoints(
  ctx: SidebarContext,
): Promise<void> {
  await saveCheckpoints(ctx.host.workspaceState, []);
  ctx.post({ type: 'setCheckpoints', checkpoints: [] });
}

export async function handleAddMemory(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'addMemory' }>,
): Promise<void> {
  try {
    const items = await commitMemoryForWorkspace(
      ctx.host.workspaceState,
      ctx.getWorkspaceId(),
      message.text,
    );
    ctx.post({ type: 'setMemories', memories: items });
  } catch (error) {
    ctx.post({
      type: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to save memory.',
    });
  }
}

export async function handleDeleteMemory(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'deleteMemory' }>,
): Promise<void> {
  const items = await deleteMemoryForWorkspace(
    ctx.host.workspaceState,
    ctx.getWorkspaceId(),
    message.id,
  );
  ctx.post({ type: 'setMemories', memories: items });
}

export async function handleClearMemory(
  ctx: SidebarContext,
): Promise<void> {
  await clearMemoriesForWorkspace(
    ctx.host.workspaceState,
    ctx.getWorkspaceId(),
  );
  ctx.post({ type: 'setMemories', memories: [] });
}

export async function handleRequestSkillCatalog(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'requestSkillCatalog' }>,
): Promise<void> {
  const q = (message.query ?? '').toLowerCase();
  const catalog = await loadDiskSkills({
    workspaceRoot: ctx.getWorkspaceRoot(),
    contentMode: 'metadata',
  });
  const items = catalog
    .filter((skill: SkillDescriptor) => {
      return (
        !q ||
        skill.id.toLowerCase().includes(q) ||
        skill.title.toLowerCase().includes(q)
      );
    })
    .map((skill: SkillDescriptor) => ({
      id: skill.id,
      name: skill.title,
      description: skill.content.slice(0, 160),
      enabled: true,
    }));
  ctx.post({
    type: 'skillCatalogResult',
    requestId: message.requestId,
    items,
  });
}
