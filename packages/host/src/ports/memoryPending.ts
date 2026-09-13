import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  MEMORY_SCHEMA_VERSION,
  type MemoryFact,
  type MemoryPipeline,
  type MemoryScope,
} from '@mitii/v8';

import { appendMemoryAudit } from './memoryAudit.js';
import { createWorkspaceMemoryLeaseStore } from './memoryLeases.js';

const PENDING_FILE_NAME = 'pending.json';
const STORAGE_VERSION = 1 as const;

export interface PendingMemoryDraft {
  id: string;
  createdAt: string;
  observationId?: string;
  content: string;
  type: MemoryFact['type'];
  title: string;
  files: string[];
  concepts: string[];
  importance: number;
  workspaceId?: string;
}

interface PendingEnvelope {
  storageVersion: typeof STORAGE_VERSION;
  pending: PendingMemoryDraft[];
}

function pendingPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'memory', PENDING_FILE_NAME);
}

async function readEnvelope(workspaceRoot: string): Promise<PendingEnvelope> {
  try {
    const raw = await readFile(pendingPath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as PendingEnvelope;
    if (
      !parsed ||
      parsed.storageVersion !== STORAGE_VERSION ||
      !Array.isArray(parsed.pending)
    ) {
      return { storageVersion: STORAGE_VERSION, pending: [] };
    }
    return {
      storageVersion: STORAGE_VERSION,
      pending: parsed.pending.filter(
        (item): item is PendingMemoryDraft =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.content === 'string',
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { storageVersion: STORAGE_VERSION, pending: [] };
    }
    return { storageVersion: STORAGE_VERSION, pending: [] };
  }
}

async function writeEnvelope(
  workspaceRoot: string,
  envelope: PendingEnvelope,
): Promise<void> {
  const filePath = pendingPath(workspaceRoot);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(envelope, null, 2)}\n`;
  await writeFile(tempPath, body, 'utf8');
  await rename(tempPath, filePath);
}

/** List memories awaiting human approve under `.mitii/memory/pending.json`. */
export async function listPendingMemories(
  workspaceRoot: string,
): Promise<PendingMemoryDraft[]> {
  const envelope = await readEnvelope(workspaceRoot);
  return [...envelope.pending];
}

/** Append a promotable draft to the pending store (host capture path). */
export async function appendPendingMemory(
  workspaceRoot: string,
  draft: PendingMemoryDraft,
): Promise<void> {
  const envelope = await readEnvelope(workspaceRoot);
  const pending = [
    ...envelope.pending.filter((item) => item.id !== draft.id),
    draft,
  ];
  await writeEnvelope(workspaceRoot, {
    storageVersion: STORAGE_VERSION,
    pending,
  });
}

/**
 * Commit a pending memory through MemoryPipeline, then remove it from the queue.
 * Takes a short `memory:approve_pending` lease so concurrent approves cannot race.
 */
export async function approvePendingMemory(input: {
  workspaceRoot: string;
  workspaceId: string;
  pendingId: string;
  pipeline: MemoryPipeline;
  now?: Date;
  holderId?: string;
}): Promise<{
  memoryId?: string;
  status: 'committed' | 'not_found' | 'rejected' | 'lease_held';
  leaseError?: string;
}> {
  const leases = createWorkspaceMemoryLeaseStore(input.workspaceRoot);
  const holderId =
    input.holderId?.trim() ||
    `approve:${input.pendingId}:${process.pid}`;

  const leased = await leases.withLease({
    resource: 'memory:approve_pending',
    holderId,
    ttlMs: 60_000,
    fn: async () => approvePendingMemoryUnlocked(input),
  });

  if (!leased.ok) {
    return {
      status: 'lease_held',
      leaseError: leased.error,
    };
  }
  return leased.value;
}

async function approvePendingMemoryUnlocked(input: {
  workspaceRoot: string;
  workspaceId: string;
  pendingId: string;
  pipeline: MemoryPipeline;
  now?: Date;
}): Promise<{ memoryId?: string; status: 'committed' | 'not_found' | 'rejected' }> {
  const now = input.now ?? new Date();
  const envelope = await readEnvelope(input.workspaceRoot);
  const draft = envelope.pending.find((item) => item.id === input.pendingId);
  if (!draft) {
    return { status: 'not_found' };
  }

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

  if (result.status !== 'committed' || !result.memoryId) {
    return { status: 'rejected' };
  }

  await writeEnvelope(input.workspaceRoot, {
    storageVersion: STORAGE_VERSION,
    pending: envelope.pending.filter((item) => item.id !== input.pendingId),
  });

  await appendMemoryAudit(input.workspaceRoot, {
    at: now.toISOString(),
    action: 'promote',
    reason: 'pending_approve',
    memoryIds: [result.memoryId],
    workspaceId: input.workspaceId,
  });

  return { memoryId: result.memoryId, status: 'committed' };
}

/** Drop a pending memory without committing. */
export async function rejectPendingMemory(input: {
  workspaceRoot: string;
  pendingId: string;
  workspaceId?: string;
  now?: Date;
}): Promise<{ rejected: boolean }> {
  const envelope = await readEnvelope(input.workspaceRoot);
  const next = envelope.pending.filter((item) => item.id !== input.pendingId);
  if (next.length === envelope.pending.length) {
    return { rejected: false };
  }
  await writeEnvelope(input.workspaceRoot, {
    storageVersion: STORAGE_VERSION,
    pending: next,
  });
  const now = input.now ?? new Date();
  await appendMemoryAudit(input.workspaceRoot, {
    at: now.toISOString(),
    action: 'reject',
    reason: 'pending_reject',
    memoryIds: [input.pendingId],
    workspaceId: input.workspaceId ?? '',
  });
  return { rejected: true };
}
