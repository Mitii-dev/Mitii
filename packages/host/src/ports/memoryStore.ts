import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  memoryFactSchema,
  type MemoryFact,
  type MemoryStorePort,
} from '@mitii/v8';

const STORAGE_VERSION = 1;
const FACTS_FILE_NAME = 'facts.json';

type MemoryScope = MemoryFact['scope'];

interface MemoryEnvelope {
  storageVersion: typeof STORAGE_VERSION;
  facts: MemoryFact[];
}

/**
 * Durable MemoryStorePort under `<workspace>/.mitii/memory/facts.json`.
 * Shared by CLI (and any non-Memento host).
 */
export class FileWorkspaceMemoryStore implements MemoryStorePort {
  private readonly filePath: string;

  constructor(workspaceRoot: string, private readonly workspaceId: string) {
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

  public async commit(fact: MemoryFact): Promise<void> {
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
    candidate.storageVersion === STORAGE_VERSION &&
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
