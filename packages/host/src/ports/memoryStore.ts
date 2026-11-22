import { atomicMemoryWrite, withMemoryFileLock } from './memoryFileIO.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import {
  memoryFactSchema,
  MemoryContentPolicy,
  type MemoryFact,
  type MemoryFactDraft,
  type MemoryStorePort,
} from '@mitii/v8';

import { appendMemoryAudit } from './memoryAudit.js';
import { MemoryStorageError } from './memoryStoreErrors.js';

const STORAGE_VERSION = 2;
const SUPPORTED_STORAGE_VERSIONS = new Set([1, 2]);
const FACTS_FILE_NAME = 'facts.json';
const MAX_ACCESS_LOG = 20;

type MemoryScope = MemoryFact['scope'];

const memoryEnvelopeSchema = z.object({
  storageVersion: z.number().int().positive(),
  facts: z.array(z.unknown()),
}).strict();

type MemoryEnvelope = z.infer<typeof memoryEnvelopeSchema>;

export interface MemoryDeleteResult {
  id: string;
  deleted: boolean;
  message: string;
}

/**
 * Serializes read-modify-write mutations through this store instance.
 * File locks coordinate separate instances and processes.
 */
class MutationQueue {
  private chain: Promise<unknown> = Promise.resolve();

  public enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation, operation);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Durable MemoryStorePort under `<workspace>/.mitii/memory/facts.json`.
 * Shared by CLI (and any non-Memento host).
 *
 * Persistence guarantees:
 * - Same-directory temp + rename (atomic file replacement)
 * - Per-instance mutation queue and exclusive file locks
 * - Read valid rows from partial data; reject mutations that would discard rows
 * - Reject corrupt and unsupported envelopes without changing their bytes
 * - Honest deletes (`deleted: false` when id missing)
 */
export class FileWorkspaceMemoryStore implements MemoryStorePort {
  private readonly filePath: string;
  private readonly workspaceRoot: string;
  private readonly mutations = new MutationQueue();

  constructor(workspaceRoot: string, private readonly workspaceId: string) {
    this.workspaceRoot = workspaceRoot;
    this.filePath = join(
      workspaceRoot,
      '.mitii',
      'memory',
      FACTS_FILE_NAME,
    );
  }

  public async query(input: {
    scope: MemoryScope;
    query: string;
  }): Promise<readonly MemoryFact[]> {
    void input.query;
    const facts = await this.readFacts();
    return facts.filter((fact) => scopesCompatible(fact.scope, input.scope));
  }

  public async commit(fact: MemoryFactDraft): Promise<void> {
    return this.mutations.enqueue(() => withMemoryFileLock(this.filePath, async () => {
      const parsed = parseFact(fact, this.workspaceId);
      if (!parsed) {
        throw new MemoryStorageError('memory_storage_invalid_fact');
      }
      const facts = await this.readFacts(true);
      const next = [
        ...facts.filter((existing) => existing.id !== parsed.id),
        parsed,
      ];
      await this.writeFacts(next);
    }));
  }

  public async transact<T>(scope: MemoryScope, decide: (facts: readonly MemoryFact[]) => {
    facts: readonly MemoryFact[]; result: T;
  }): Promise<T> {
    return this.mutations.enqueue(() => withMemoryFileLock(this.filePath, async () => {
      const current = await this.readFacts(true);
      const decision = decide(current.filter(row => scopesCompatible(row.scope, scope)));
      const changed = memoryFactSchema.array().parse(decision.facts).map(row => new MemoryContentPolicy().fact(row));
      if (changed.some(row => !scopesCompatible(row.scope, scope) ||
        current.some(old => old.id === row.id && !scopesCompatible(old.scope, scope)))) {
        throw new Error('Memory transaction scope mismatch.');
      }
      if (new Set(changed.map(row => row.id)).size !== changed.length) throw new Error('Duplicate transaction IDs.');
      if (changed.length) {
        const ids = new Set(changed.map(row => row.id));
        await this.writeFacts([...current.filter(row => !ids.has(row.id)), ...changed]);
      }
      return decision.result;
    }));
  }

  public async list(scope?: MemoryScope): Promise<readonly MemoryFact[]> {
    const facts = await this.readFacts();
    return scope
      ? facts.filter((fact) => scopesCompatible(fact.scope, scope))
      : facts;
  }

  public async recordAccess(ids: readonly string[], at: string): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    return this.mutations.enqueue(() => withMemoryFileLock(this.filePath, async () => {
      const wanted = new Set(ids);
      const facts = await this.readFacts(true);
      const next = facts.map((fact) =>
        wanted.has(fact.id) ? touchAccess(fact, at) : fact,
      );
      await this.writeFacts(next);
    }));
  }

  public async delete(
    id: string,
    reason = 'user_delete',
  ): Promise<MemoryDeleteResult> {
    return this.mutations.enqueue(() => withMemoryFileLock(this.filePath, async () => {
      const facts = await this.readFacts(true);
      const existed = facts.some((fact) => fact.id === id);
      if (!existed) {
        return {
          id,
          deleted: false,
          message: `Memory id "${id}" not found.`,
        };
      }
      await this.writeFacts(facts.filter((fact) => fact.id !== id));
      await appendMemoryAudit(this.workspaceRoot, {
        at: new Date().toISOString(),
        action: 'delete',
        reason,
        memoryIds: [id],
        workspaceId: this.workspaceId,
      });
      return {
        id,
        deleted: true,
        message: `Deleted memory id "${id}".`,
      };
    }));
  }

  private async readFacts(forMutation = false): Promise<MemoryFact[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new MemoryStorageError('memory_storage_corrupt');
    }

    const envelope = memoryEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      throw new MemoryStorageError('memory_storage_corrupt');
    }
    if (!SUPPORTED_STORAGE_VERSIONS.has(envelope.data.storageVersion)) {
      throw new MemoryStorageError('memory_storage_version_unsupported');
    }

    const facts = envelope.data.facts
      .map((fact) => parseFact(fact, this.workspaceId))
      .filter((fact): fact is MemoryFact => fact !== null);
    if (forMutation && (
      facts.length !== envelope.data.facts.length ||
      new Set(facts.map(fact => fact.id)).size !== facts.length
    )) {
      throw new MemoryStorageError('memory_storage_recovery_required');
    }
    return facts;
  }

  private async writeFacts(facts: readonly MemoryFact[]): Promise<void> {
    const result = memoryFactSchema.array().safeParse(facts);
    if (!result.success) {
      throw new MemoryStorageError('memory_storage_invalid_fact');
    }
    const envelope: MemoryEnvelope = {
      storageVersion: STORAGE_VERSION,
      facts: result.data.map(row => new MemoryContentPolicy().fact(row)),
    };
    await atomicMemoryWrite(this.filePath, `${JSON.stringify(envelope, null, 2)}\n`);
  }
}

export function createWorkspaceMemoryStore(
  workspaceRoot: string,
  workspaceId: string,
): FileWorkspaceMemoryStore {
  return new FileWorkspaceMemoryStore(workspaceRoot, workspaceId);
}

function parseFact(raw: unknown, workspaceId: string): MemoryFact | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const fact = raw as Record<string, unknown>;
  // Fill absent legacy fields only. Invalid metadata and unknown fields must
  // survive to validation so a mutation cannot silently normalize them away.
  const result = memoryFactSchema.safeParse({
    ...fact,
    scope: fact.scope === undefined ? { kind: 'workspace', workspaceId } : fact.scope,
    privacy: fact.privacy === undefined ? 'shareable' : fact.privacy,
    concepts: fact.concepts === undefined ? fact.tags : fact.concepts,
    createdAt: normalizeDateTime(fact.createdAt),
    ...(fact.expiresAt === undefined ? {} : { expiresAt: normalizeDateTime(fact.expiresAt) }),
    ...(fact.lastAccessedAt === undefined ? {} : { lastAccessedAt: normalizeDateTime(fact.lastAccessedAt) }),
  });

  return result.success ? result.data : null;
}

function normalizeDateTime(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function scopesCompatible(fact: MemoryScope, request: MemoryScope): boolean {
  if (fact.kind !== request.kind) return false;
  if (fact.kind === 'user') return fact.userId === request.userId;
  if (fact.kind === 'workspace') {
    return fact.workspaceId === request.workspaceId;
  }
  return fact.projectId === request.projectId;
}

function touchAccess(fact: MemoryFact, at: string): MemoryFact {
  return {
    ...fact,
    accessCount: fact.accessCount + 1,
    lastAccessedAt: at,
    accessLog: [...fact.accessLog, at].slice(-MAX_ACCESS_LOG),
  };
}
