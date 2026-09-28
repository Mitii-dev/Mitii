import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { atomicMemoryWrite, withMemoryFileLock } from './memoryFileIO.js';
import { join } from 'node:path';

import {
  MEMORY_SCHEMA_VERSION,
  MemoryContentPolicy,
  memoryFactSchema,
  type MemoryPipeline,
  type MemoryScope,
} from '@mitii/v8';

import { appendMemoryAudit } from './memoryAudit.js';
import { createWorkspaceMemoryLeaseStore } from './memoryLeases.js';

const PENDING_FILE_NAME = 'pending.json';
const STORAGE_VERSION = 1 as const;

const pendingMemoryDraftSchema = z.object({
  id: z.string().min(1), createdAt: z.string().datetime(), observationId: z.string().min(1).optional(),
  content: z.string().min(1).max(16_000), type: memoryFactSchema.shape.type,
  title: z.string().min(1), files: z.array(z.string()), concepts: z.array(z.string()),
  importance: z.number().int().min(1).max(10), workspaceId: z.string().optional(),
}).strict();
export type PendingMemoryDraft = z.infer<typeof pendingMemoryDraftSchema>;
const pendingEnvelopeSchema = z.object({ storageVersion: z.literal(STORAGE_VERSION),
  pending: z.array(pendingMemoryDraftSchema).max(1000) }).strict();
type PendingEnvelope = z.infer<typeof pendingEnvelopeSchema>;

function pendingPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'memory', PENDING_FILE_NAME);
}

async function readEnvelope(workspaceRoot: string): Promise<PendingEnvelope> {
  try {
    const raw = await readFile(pendingPath(workspaceRoot), 'utf8');
    return pendingEnvelopeSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { storageVersion: STORAGE_VERSION, pending: [] };
    }
    throw error;
  }
}

async function writeEnvelope(
  workspaceRoot: string,
  envelope: PendingEnvelope,
): Promise<void> {
  const validated = pendingEnvelopeSchema.parse(envelope);
  const policy = new MemoryContentPolicy();
  validated.pending = validated.pending.map(row => ({ ...row,
    content: policy.sanitize(row.content), title: policy.sanitize(row.title),
    files: row.files.map(value => policy.sanitize(value)), concepts: row.concepts.map(value => policy.sanitize(value)),
  }));
  await atomicMemoryWrite(pendingPath(workspaceRoot), `${JSON.stringify(validated, null, 2)}\n`);
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
  return withMemoryFileLock(pendingPath(workspaceRoot), async () => {
  const envelope = await readEnvelope(workspaceRoot);
  const pending = [
    ...envelope.pending.filter((item) => item.id !== draft.id),
    draft,
  ];
  await writeEnvelope(workspaceRoot, {
    storageVersion: STORAGE_VERSION,
    pending,
  });
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
    fn: async () => withMemoryFileLock(pendingPath(input.workspaceRoot), () => approvePendingMemoryUnlocked(input)),
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
  if (!draft || (draft.workspaceId && draft.workspaceId !== input.workspaceId)) {
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
    sourceIds: [draft.observationId ?? draft.id, draft.id],
    evidence: [{ id: draft.observationId ?? draft.id, kind: 'user_statement', verified: false }],
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
  return withMemoryFileLock(pendingPath(input.workspaceRoot), async () => {
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
  });
}
