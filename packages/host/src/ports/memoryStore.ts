import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  memoryFactSchema,
  type MemoryFact,
  type MemoryFactDraft,
  type MemoryStorePort,
} from '@mitii/v8';

import { appendMemoryAudit } from './memoryAudit.js';

const STORAGE_VERSION = 2;
const SUPPORTED_STORAGE_VERSIONS = new Set([1, 2]);
const FACTS_FILE_NAME = 'facts.json';
const MAX_ACCESS_LOG = 20;

type MemoryScope = MemoryFact['scope'];

interface MemoryEnvelope {
  storageVersion: 1 | 2;
  facts: MemoryFact[];
}

/**
 * Durable MemoryStorePort under `<workspace>/.mitii/memory/facts.json`.
 * Shared by CLI (and any non-Memento host).
 */
export class FileWorkspaceMemoryStore implements MemoryStorePort {
  private readonly filePath: string;
  private readonly workspaceRoot: string;

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
    const parsed = parseFact(fact, this.workspaceId);
    if (!parsed) {
      throw new Error('Memory commit rejected: fact failed schema validation.');
    }
    const facts = await this.readFacts();
    const next = [
      ...facts.filter((existing) => existing.id !== parsed.id),
      parsed,
    ];
    await this.writeFacts(next);
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
    const wanted = new Set(ids);
    const facts = await this.readFacts();
    const next = facts.map((fact) =>
      wanted.has(fact.id) ? touchAccess(fact, at) : fact,
    );
    await this.writeFacts(next);
  }

  public async delete(id: string, reason = 'user_delete'): Promise<void> {
    const facts = await this.readFacts();
    await this.writeFacts(facts.filter((fact) => fact.id !== id));
    await appendMemoryAudit(this.workspaceRoot, {
      at: new Date().toISOString(),
      action: 'delete',
      reason,
      memoryIds: [id],
      workspaceId: this.workspaceId,
    });
  }

  private async readFacts(): Promise<MemoryFact[]> {
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
      return [];
    }

    if (!isEnvelope(parsed)) {
      return [];
    }

    return parsed.facts
      .map((fact) => parseFact(fact, this.workspaceId))
      .filter((fact): fact is MemoryFact => fact !== null);
  }

  private async writeFacts(facts: readonly MemoryFact[]): Promise<void> {
    const validated = facts
      .map((fact) => parseFact(fact, this.workspaceId))
      .filter((fact): fact is MemoryFact => fact !== null);
    const envelope: MemoryEnvelope = {
      storageVersion: STORAGE_VERSION,
      facts: validated,
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }
}

export function createWorkspaceMemoryStore(
  workspaceRoot: string,
  workspaceId: string,
): FileWorkspaceMemoryStore {
  return new FileWorkspaceMemoryStore(workspaceRoot, workspaceId);
}

function parseFact(raw: unknown, workspaceId: string): MemoryFact | null {
  if (!raw || typeof raw !== 'object') return null;
  const fact = raw as Record<string, unknown>;
  const createdAt =
    typeof fact.createdAt === 'string'
      ? normalizeDateTime(fact.createdAt)
      : new Date().toISOString();
  const expiresAt =
    typeof fact.expiresAt === 'string'
      ? normalizeDateTime(fact.expiresAt)
      : undefined;

  const result = memoryFactSchema.safeParse({
    id: fact.id,
    content: fact.content,
    scope: fact.scope ?? { kind: 'workspace', workspaceId },
    tags: Array.isArray(fact.tags) ? fact.tags : [],
    privacy: fact.privacy ?? 'shareable',
    createdAt,
    ...(expiresAt ? { expiresAt } : {}),
    source:
      typeof fact.source === 'string' && fact.source.trim().length > 0
        ? fact.source
        : 'user',
    ...(typeof fact.type === 'string' ? { type: fact.type } : {}),
    ...(typeof fact.title === 'string' && fact.title.trim().length > 0
      ? { title: fact.title }
      : {}),
    concepts: Array.isArray(fact.concepts)
      ? fact.concepts
      : Array.isArray(fact.tags)
        ? fact.tags
        : [],
    files: Array.isArray(fact.files) ? fact.files : [],
    ...(typeof fact.importance === 'number' ? { importance: fact.importance } : {}),
    sourceIds: Array.isArray(fact.sourceIds) ? fact.sourceIds : [],
    ...(typeof fact.version === 'number' ? { version: fact.version } : {}),
    ...(typeof fact.isLatest === 'boolean' ? { isLatest: fact.isLatest } : {}),
    supersedes: Array.isArray(fact.supersedes) ? fact.supersedes : [],
    ...(typeof fact.contentHash === 'string' && fact.contentHash.trim().length > 0
      ? { contentHash: fact.contentHash }
      : {}),
    ...(typeof fact.accessCount === 'number' ? { accessCount: fact.accessCount } : {}),
    ...(typeof fact.lastAccessedAt === 'string'
      ? { lastAccessedAt: normalizeDateTime(fact.lastAccessedAt) }
      : {}),
    accessLog: Array.isArray(fact.accessLog)
      ? fact.accessLog.filter((item): item is string => typeof item === 'string')
      : [],
  });

  return result.success ? result.data : null;
}

function normalizeDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function isEnvelope(value: unknown): value is MemoryEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MemoryEnvelope>;
  return (
    typeof candidate.storageVersion === 'number' &&
    SUPPORTED_STORAGE_VERSIONS.has(candidate.storageVersion) &&
    Array.isArray(candidate.facts)
  );
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
