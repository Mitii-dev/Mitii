import type * as vscode from 'vscode';
import {
  MEMORY_SCHEMA_VERSION,
  MemoryContentPolicy,
  MemoryPipeline,
  memoryFactSchema,
  type MemoryFact,
  type MemoryFactDraft,
  type MemoryStorePort,
} from '@mitii/v8';

type MemoryScope = MemoryFact['scope'];

export const MEMORY_KEY = 'mitii.memories.v1';
const STORAGE_VERSION = 2;
const SUPPORTED_STORAGE_VERSIONS = new Set([1, 2]);
const MAX_ACCESS_LOG = 20;

/** Host/UI facts are shareable within the workspace by default. */
const HOST_DEFAULT_PRIVACY = 'shareable' as const;

export interface LegacyMemoryItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface MemoryItemView {
  id: string;
  text: string;
  createdAt: string;
}

interface MemoryEnvelope {
  storageVersion: number;
  facts: unknown[];
}

/**
 * Serializes RMW so concurrent commits/deletes cannot last-write-wins
 * (same pattern as FileWorkspaceMemoryStore).
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

export interface MemoryDeleteResult {
  id: string;
  deleted: boolean;
  message: string;
}

/**
 * VS Code durable adapter for V8 Memory.
 *
 * Migrates legacy `{ id, text, createdAt }` into canonical MemoryFact records.
 * Corrupt or unsupported envelopes reject without wiping memento state.
 */
export class VsCodeMementoMemoryStore implements MemoryStorePort {
  private readonly mutations = new MutationQueue();
  private readonly policy = new MemoryContentPolicy();

  constructor(
    private readonly state: vscode.Memento,
    private readonly workspaceId: string,
  ) {}

  public async query(input: {
    scope: MemoryScope;
    query: string;
  }): Promise<readonly MemoryFact[]> {
    void input.query;
    const facts = await this.readFacts();
    return facts.filter((fact) => scopesCompatible(fact.scope, input.scope));
  }

  public async commit(fact: MemoryFactDraft): Promise<void> {
    return this.mutations.enqueue(async () => {
      const parsed = parseFact(fact, this.workspaceId);
      if (!parsed) {
        throw new Error(
          'Memory commit rejected: fact failed schema validation.',
        );
      }
      const facts = await this.readFacts(true);
      const next = [
        ...facts.filter((existing) => existing.id !== parsed.id),
        this.policy.fact(parsed),
      ];
      await this.writeFacts(next);
    });
  }

  public async transact<T>(
    scope: MemoryScope,
    decide: (facts: readonly MemoryFact[]) => {
      facts: readonly MemoryFact[];
      result: T;
    },
  ): Promise<T> {
    return this.mutations.enqueue(async () => {
      const current = await this.readFacts(true);
      const decision = decide(
        current.filter((row) => scopesCompatible(row.scope, scope)),
      );
      const changed: MemoryFact[] = memoryFactSchema
        .array()
        .parse(decision.facts)
        .map((row: MemoryFact) => this.policy.fact(row));
      if (
        changed.some(
          (row: MemoryFact) =>
            !scopesCompatible(row.scope, scope) ||
            current.some(
              (old) =>
                old.id === row.id && !scopesCompatible(old.scope, scope),
            ),
        )
      ) {
        throw new Error('Memory transaction scope mismatch.');
      }
      if (new Set(changed.map((row: MemoryFact) => row.id)).size !== changed.length) {
        throw new Error('Duplicate transaction IDs.');
      }
      if (changed.length) {
        const ids = new Set(changed.map((row: MemoryFact) => row.id));
        await this.writeFacts([
          ...current.filter((row) => !ids.has(row.id)),
          ...changed,
        ]);
      }
      return decision.result;
    });
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
    return this.mutations.enqueue(async () => {
      const wanted = new Set(ids);
      const facts = await this.readFacts(true);
      await this.writeFacts(
        facts.map((fact) =>
          wanted.has(fact.id) ? touchAccess(fact, at) : fact,
        ),
      );
    });
  }

  public async delete(id: string): Promise<MemoryDeleteResult> {
    return this.mutations.enqueue(async () => {
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
      return {
        id,
        deleted: true,
        message: `Deleted memory id "${id}".`,
      };
    });
  }

  public async clear(scope?: MemoryScope): Promise<void> {
    return this.mutations.enqueue(async () => {
      const facts = await this.readFacts(true);
      await this.writeFacts(
        scope
          ? facts.filter((fact) => !scopesCompatible(fact.scope, scope))
          : [],
      );
    });
  }

  public async listForView(): Promise<MemoryItemView[]> {
    const facts = await this.list(workspaceScope(this.workspaceId));
    return facts
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((fact) => ({
        id: fact.id,
        text: fact.content,
        createdAt: fact.createdAt,
      }));
  }

  private async readFacts(forMutation = false): Promise<MemoryFact[]> {
    const raw = this.state.get<unknown>(MEMORY_KEY);
    if (!raw) return [];

    if (Array.isArray(raw)) {
      const facts = raw
        .filter(isLegacyMemoryItem)
        .map((item) => legacyItemToFact(item, this.workspaceId))
        .filter((fact): fact is MemoryFact => fact !== null)
        .map((fact) => this.policy.fact(fact));
      if (forMutation) {
        await this.writeFacts(facts);
      }
      return facts;
    }

    if (!isEnvelope(raw)) {
      throw new Error(
        'Memory storage contains an invalid envelope. Recover the original memento value before retrying.',
      );
    }
    if (!SUPPORTED_STORAGE_VERSIONS.has(raw.storageVersion)) {
      throw new Error(
        'Memory storage uses an unsupported version. Open it with a compatible Mitii version before retrying.',
      );
    }

    const facts = raw.facts
      .map((fact) => parseFact(fact, this.workspaceId))
      .filter((fact): fact is MemoryFact => fact !== null);
    if (
      forMutation &&
      (facts.length !== raw.facts.length ||
        new Set(facts.map((fact) => fact.id)).size !== facts.length)
    ) {
      throw new Error(
        'Memory storage contains invalid facts or duplicate IDs. Recover before modifying memory.',
      );
    }
    return facts;
  }

  private async writeFacts(facts: readonly MemoryFact[]): Promise<void> {
    const result = memoryFactSchema.array().safeParse(facts);
    if (!result.success) {
      throw new Error(
        'Memory mutation rejected: a fact failed schema validation.',
      );
    }
    const envelope: MemoryEnvelope = {
      storageVersion: STORAGE_VERSION,
      facts: result.data.map((row: MemoryFact) => this.policy.fact(row)),
    };
    await this.state.update(MEMORY_KEY, envelope);
  }
}

export function createVsCodeMemoryStore(
  state: vscode.Memento,
  workspaceId: string,
): VsCodeMementoMemoryStore {
  return new VsCodeMementoMemoryStore(state, workspaceId);
}

export async function loadMemoriesForView(
  state: vscode.Memento,
  workspaceId: string,
): Promise<MemoryItemView[]> {
  return new VsCodeMementoMemoryStore(state, workspaceId).listForView();
}

/**
 * Upper-bound estimate of memory text the engine may inject (before budget).
 */
export async function estimateMemoryPromptBlock(
  state: vscode.Memento,
  workspaceId: string,
): Promise<string | undefined> {
  const items = await loadMemoriesForView(state, workspaceId);
  if (!items.length) return undefined;
  return items.map((item) => item.text).join('\n');
}

export async function commitMemoryForWorkspace(
  state: vscode.Memento,
  workspaceId: string,
  content: string,
): Promise<MemoryItemView[]> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Memory content must not be empty.');
  }

  const store = new VsCodeMementoMemoryStore(state, workspaceId);
  const pipeline = new MemoryPipeline({ store });
  const result = await pipeline.commit({
    schemaVersion: MEMORY_SCHEMA_VERSION,
    content: trimmed,
    scope: workspaceScope(workspaceId),
    tags: [],
    privacy: HOST_DEFAULT_PRIVACY,
    source: 'user',
    type: 'preference',
  });

  if (result.status !== 'committed') {
    throw new Error(result.warnings[0] ?? 'Memory commit rejected.');
  }

  return store.listForView();
}

export async function deleteMemoryForWorkspace(
  state: vscode.Memento,
  workspaceId: string,
  id: string,
): Promise<MemoryItemView[]> {
  const store = new VsCodeMementoMemoryStore(state, workspaceId);
  await store.delete(id);
  return store.listForView();
}

export async function clearMemoriesForWorkspace(
  state: vscode.Memento,
  workspaceId: string,
): Promise<void> {
  await new VsCodeMementoMemoryStore(state, workspaceId).clear(
    workspaceScope(workspaceId),
  );
}

export function workspaceScope(workspaceId: string): MemoryScope {
  return { kind: 'workspace', workspaceId };
}

function legacyItemToFact(
  item: LegacyMemoryItem,
  workspaceId: string,
): MemoryFact | null {
  return parseFact(
    {
      id: item.id,
      content: item.text,
      scope: workspaceScope(workspaceId),
      tags: [],
      privacy: HOST_DEFAULT_PRIVACY,
      createdAt: normalizeDateTime(item.createdAt),
      source: 'user',
    },
    workspaceId,
  );
}

function normalizeDateTime(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isEnvelope(value: unknown): value is MemoryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<MemoryEnvelope>;
  return (
    typeof candidate.storageVersion === 'number' &&
    Array.isArray(candidate.facts)
  );
}

/**
 * Coerce host/disk records into MemoryFact shape, then validate with Zod.
 * Invalid rows return null so mutations can refuse before discarding them.
 */
function parseFact(raw: unknown, workspaceId: string): MemoryFact | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const fact = raw as Record<string, unknown>;
  const result = memoryFactSchema.safeParse({
    ...fact,
    scope: fact.scope === undefined ? workspaceScope(workspaceId) : fact.scope,
    privacy: fact.privacy === undefined ? HOST_DEFAULT_PRIVACY : fact.privacy,
    concepts: fact.concepts === undefined ? fact.tags : fact.concepts,
    createdAt: normalizeDateTime(fact.createdAt),
    ...(fact.expiresAt === undefined
      ? {}
      : { expiresAt: normalizeDateTime(fact.expiresAt) }),
    ...(fact.lastAccessedAt === undefined
      ? {}
      : { lastAccessedAt: normalizeDateTime(fact.lastAccessedAt) }),
  });

  return result.success ? result.data : null;
}

function isLegacyMemoryItem(value: unknown): value is LegacyMemoryItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LegacyMemoryItem>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'string'
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
