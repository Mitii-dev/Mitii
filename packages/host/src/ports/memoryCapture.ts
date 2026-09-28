import { createHash, randomUUID } from 'node:crypto';

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
import { appendPendingMemory } from './memoryPending.js';

const DEDUP_WINDOW_MS = 5 * 60 * 1000;

export interface ObserveWorkspaceEventInput extends SyntheticObservationInput {
  workspaceRoot: string;
  workspaceId: string;
  pipeline: MemoryPipeline;
  now?: Date;
  /**
   * When true, promotable drafts commit immediately (legacy behavior).
   * Default false: write `.mitii/memory/pending.json` for human approve.
   */
  autoPromote?: boolean;
}

export interface ObserveWorkspaceEventResult {
  observationId?: string;
  promotedMemoryId?: string;
  pendingMemoryId?: string;
  duplicate: boolean;
  evictedIds: string[];
}

/**
 * Host-owned capture: persist a raw observation, then optionally promote
 * preference / bug-like events (autoPromote) or queue them for approve.
 */
export async function observeWorkspaceEvent(
  input: ObserveWorkspaceEventInput,
): Promise<ObserveWorkspaceEventResult> {
  const now = input.now ?? new Date();
  const autoPromote = input.autoPromote === true;
  const draft = buildSyntheticMemoryDraft(input);
  const hash = createHash('sha256').update(JSON.stringify([input.toolName, draft.content, draft.files])).digest('hex');

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

  const observationId = `obs_${randomUUID()}`;
  let promotedMemoryId: string | undefined;
  let pendingMemoryId: string | undefined;

  if (draft.promotable && autoPromote) {
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
      sourceIds: [observationId],
      evidence: [{ id: observationId, kind: input.verified ? 'verification' : 'user_statement', verified: input.verified === true }],
      now: now.toISOString(),
    });
    if (result.status === 'committed') {
      promotedMemoryId = result.memoryId;
    }
  } else if (draft.promotable && !autoPromote) {
    pendingMemoryId = `pend_${randomUUID()}`;
    await appendPendingMemory(input.workspaceRoot, {
      id: pendingMemoryId,
      createdAt: now.toISOString(),
      observationId,
      content: draft.content,
      type: draft.type,
      title: draft.title,
      files: draft.files,
      concepts: draft.concepts,
      importance: draft.importance,
      workspaceId: input.workspaceId,
    });
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
    reason: promotedMemoryId
      ? 'synthetic_promote'
      : pendingMemoryId
        ? 'synthetic_pending'
        : 'synthetic_observe',
    memoryIds: promotedMemoryId
      ? [promotedMemoryId]
      : pendingMemoryId
        ? [pendingMemoryId]
        : [observationId],
    workspaceId: input.workspaceId,
  });

  return {
    observationId,
    promotedMemoryId,
    pendingMemoryId,
    duplicate: false,
    evictedIds: appended.evictedIds,
  };
}
