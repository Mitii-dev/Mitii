import type * as vscode from 'vscode';
import {
  MEMORY_SCHEMA_VERSION,
  MemoryPipeline,
  memoryFactSchema,
  type MemoryFact,
  type MemoryStorePort,
} from '@mitii/v8';

type MemoryScope = MemoryFact['scope'];

export const MEMORY_KEY = 'mitii.memories.v1';
const STORAGE_VERSION = 1;

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
  storageVersion: typeof STORAGE_VERSION;
  facts: MemoryFact[];
}

/**
 * VS Code durable adapter for V8 Memory.
 *
 * The webview used to store `{ id, text, createdAt }` directly. This adapter
 * migrates that shadow format into canonical MemoryFact records and then keeps
 * the engine-facing store as the source of truth.
 */
export class VsCodeMementoMemoryStore implements MemoryStorePort {
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

  public async delete(id: string): Promise<void> {
    const facts = await this.readFacts();
    await this.writeFacts(facts.filter((fact) => fact.id !== id));
  }

  public async clear(scope?: MemoryScope): Promise<void> {
    const facts = await this.readFacts();
    await this.writeFacts(
      scope ? facts.filter((fact) => !scopesCompatible(fact.scope, scope)) : [],
    );
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

  private async readFacts(): Promise<MemoryFact[]> {
    const raw = this.state.get<unknown>(MEMORY_KEY);
    if (!raw) return [];

    if (isEnvelope(raw)) {
      return raw.facts
        .map((fact) => parseFact(fact, this.workspaceId))
        .filter((fact): fact is MemoryFact => fact !== null);
    }

    if (Array.isArray(raw)) {
      const facts = raw
        .filter(isLegacyMemoryItem)
        .map((item) => legacyItemToFact(item, this.workspaceId))
        .filter((fact): fact is MemoryFact => fact !== null);
      await this.writeFacts(facts);
      return facts;
    }

    await this.writeFacts([]);
    return [];
  }

  private async writeFacts(facts: readonly MemoryFact[]): Promise<void> {
    const validated = facts
      .map((fact) => parseFact(fact, this.workspaceId))
      .filter((fact): fact is MemoryFact => fact !== null);
    const envelope: MemoryEnvelope = {
      storageVersion: STORAGE_VERSION,
      facts: validated,
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

/**
 * Coerce host/disk records into MemoryFact shape, then validate with Zod.
 * Corrupt entries are dropped rather than reaching the Engine.
 */
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
    scope: fact.scope ?? workspaceScope(workspaceId),
    tags: Array.isArray(fact.tags) ? fact.tags : [],
    privacy: fact.privacy ?? HOST_DEFAULT_PRIVACY,
    createdAt,
    ...(expiresAt ? { expiresAt } : {}),
    source:
      typeof fact.source === 'string' && fact.source.trim().length > 0
        ? fact.source
        : 'user',
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
