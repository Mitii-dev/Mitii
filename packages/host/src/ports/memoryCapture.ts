import { createHash } from 'node:crypto';

import {
  MEMORY_SCHEMA_VERSION,
  MemoryPipeline,
  buildSyntheticMemoryDraft,
  type MemoryScope,
  type SyntheticObservationInput,
} from '@mitii/v8';

import { appendMemoryAudit } from './memoryAudit.js';
import {
  FileWorkspaceObservationStore,
  MAX_OBSERVATIONS_PER_WORKSPACE,
} from './memoryObservations.js';

const DEDUP_WINDOW_MS = 5 * 60 * 1000;

export interface ObserveWorkspaceEventInput extends SyntheticObservationInput {
  workspaceRoot: string;
  workspaceId: string;
  pipeline: MemoryPipeline;
  now?: Date;
}

export interface ObserveWorkspaceEventResult {
  observationId?: string;
  promotedMemoryId?: string;
  duplicate: boolean;
  evictedIds: string[];
}

/**
 * Host-owned capture: persist a raw observation, then promote only
 * preference / bug-like events through MemoryPipeline.commit.
 */
export async function observeWorkspaceEvent(
  input: ObserveWorkspaceEventInput,
): Promise<ObserveWorkspaceEventResult> {
  const now = input.now ?? new Date();
  const draft = buildSyntheticMemoryDraft(input);
  const hash = createHash('sha256')
    .update(
      `${input.toolName ?? ''}:${JSON.stringify(input.toolInput ?? '').slice(0, 500)}`,
    )
    .digest('hex');

  const store = new FileWorkspaceObservationStore(input.workspaceRoot);
  const duplicate = await store.findRecentHash(hash, DEDUP_WINDOW_MS, now);
  if (duplicate) {
    return {
      observationId: duplicate.id,
      promotedMemoryId: duplicate.promotedMemoryId,
      duplicate: true,
      evictedIds: [],
    };
  }

  const observationId = `obs_${now.getTime().toString(36)}`;
  let promotedMemoryId: string | undefined;
  if (draft.promotable) {
    const scope: MemoryScope = {
      kind: 'workspace',
      workspaceId: input.workspaceId,
    };
    const result = await input.pipeline.commit({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      content: draft.content,
      scope,
      type: draft.type,
      title: draft.title,
      files: draft.files,
      concepts: draft.concepts,
      importance: draft.importance,
      privacy: 'shareable',
      source: 'observe',
      now: now.toISOString(),
    });
    if (result.status === 'committed') {
      promotedMemoryId = result.memoryId;
    }
  }

  const appended = await store.append(
    {
      id: observationId,
      createdAt: now.toISOString(),
      toolName: input.toolName,
      hookType: input.hookType,
      content: draft.content,
      files: draft.files,
      hash,
      promotedMemoryId,
    },
    MAX_OBSERVATIONS_PER_WORKSPACE,
  );

  if (appended.evictedIds.length > 0) {
    await appendMemoryAudit(input.workspaceRoot, {
      at: now.toISOString(),
      action: 'evict',
      reason: 'observation_cap',
      memoryIds: appended.evictedIds,
      workspaceId: input.workspaceId,
    });
  }
  await appendMemoryAudit(input.workspaceRoot, {
    at: now.toISOString(),
    action: promotedMemoryId ? 'promote' : 'observe',
    reason: draft.promotable ? 'synthetic_promote' : 'synthetic_observe',
    memoryIds: promotedMemoryId ? [promotedMemoryId] : [observationId],
    workspaceId: input.workspaceId,
  });

  return {
    observationId,
    promotedMemoryId,
    duplicate: false,
    evictedIds: appended.evictedIds,
  };
}
