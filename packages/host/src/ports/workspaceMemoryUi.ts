/**
 * Workspace Memory helpers for host UIs (Desktop / CLI-adjacent).
 * Durable store: `.mitii/memory/facts.json` via FileWorkspaceMemoryStore.
 */

import {
  MEMORY_SCHEMA_VERSION,
  MemoryPipeline,
  type MemoryFact,
  type MemoryScope,
} from '@mitii/v8';

import { createWorkspaceMemoryStore } from './memoryStore.js';

export interface MemoryItemView {
  id: string;
  text: string;
  createdAt: string;
}

const HOST_DEFAULT_PRIVACY = 'shareable' as const;

export function workspaceMemoryScope(workspaceId: string): MemoryScope {
  return { kind: 'workspace', workspaceId };
}

export function memoryFactToView(fact: MemoryFact): MemoryItemView {
  return {
    id: fact.id,
    text: fact.content,
    createdAt: fact.createdAt,
  };
}

export async function listWorkspaceMemoriesForView(
  workspaceRoot: string,
  workspaceId: string,
): Promise<MemoryItemView[]> {
  const store = createWorkspaceMemoryStore(workspaceRoot, workspaceId);
  const facts = await store.list(workspaceMemoryScope(workspaceId));
  return [...facts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(memoryFactToView);
}

export async function commitWorkspaceMemory(input: {
  workspaceRoot: string;
  workspaceId: string;
  content: string;
}): Promise<MemoryItemView[]> {
  const trimmed = input.content.trim();
  if (!trimmed) {
    throw new Error('Memory content must not be empty.');
  }

  const store = createWorkspaceMemoryStore(
    input.workspaceRoot,
    input.workspaceId,
  );
  const pipeline = new MemoryPipeline({ store });
  const result = await pipeline.commit({
    schemaVersion: MEMORY_SCHEMA_VERSION,
    content: trimmed,
    scope: workspaceMemoryScope(input.workspaceId),
    tags: [],
    privacy: HOST_DEFAULT_PRIVACY,
    source: 'user',
    type: 'preference',
  });

  if (result.status !== 'committed') {
    throw new Error(result.warnings[0] ?? 'Memory commit rejected.');
  }

  return listWorkspaceMemoriesForView(input.workspaceRoot, input.workspaceId);
}

export async function deleteWorkspaceMemory(input: {
  workspaceRoot: string;
  workspaceId: string;
  id: string;
}): Promise<MemoryItemView[]> {
  const store = createWorkspaceMemoryStore(
    input.workspaceRoot,
    input.workspaceId,
  );
  await store.delete(input.id);
  return listWorkspaceMemoriesForView(input.workspaceRoot, input.workspaceId);
}

export async function clearWorkspaceMemories(input: {
  workspaceRoot: string;
  workspaceId: string;
}): Promise<void> {
  const store = createWorkspaceMemoryStore(
    input.workspaceRoot,
    input.workspaceId,
  );
  const facts = await store.list(workspaceMemoryScope(input.workspaceId));
  for (const fact of facts) {
    await store.delete(fact.id);
  }
}
