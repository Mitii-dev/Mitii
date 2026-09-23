/**
 * Desktop chat history — `.mitii/desktop-chat-history.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DesktopChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: string;
  status?: string;
}

/** Persisted token meter summary for a chat thread. */
export interface DesktopThreadTokenUsage {
  inputTokensTotal: number;
  outputTokensTotal: number;
  sessionTotal: number;
  modelCalls: number;
  toolCalls: number;
  turnCount: number;
  lastPromptTokens: number;
  lastResponseTokens: number;
  currentTurnTotal: number;
  contextWindow: number;
  durationMs?: number;
  contextBreakdown?: unknown;
}

export interface DesktopChatThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: DesktopChatMessage[];
  tokenUsage?: DesktopThreadTokenUsage;
  /** Structured plan from Plan mode — handed to Agent on "Start building". */
  pendingPlan?: unknown;
  pendingPlanStrategy?: unknown;
  pendingTaskList?: unknown;
}

export interface DesktopHistoryStore {
  threads: DesktopChatThread[];
  activeThreadId?: string;
}

function historyPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'desktop-chat-history.json');
}

function empty(): DesktopHistoryStore {
  return { threads: [], activeThreadId: undefined };
}

function normalizeMessage(raw: unknown): DesktopChatMessage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const role = obj.role === 'assistant' ? 'assistant' : 'user';
  const base: DesktopChatMessage = {
    id: String(obj.id ?? `m_${Date.now()}`),
    role,
    text: typeof obj.text === 'string' ? obj.text : '',
    ...(typeof obj.mode === 'string' ? { mode: obj.mode } : {}),
    ...(typeof obj.status === 'string' ? { status: obj.status } : {}),
  };
  // Preserve richer desktop fields (activity timeline, file-change cards).
  return {
    ...base,
    ...(Array.isArray(obj.activity) ? { activity: obj.activity } : {}),
    ...(obj.fileChanges && typeof obj.fileChanges === 'object'
      ? { fileChanges: obj.fileChanges }
      : {}),
  } as DesktopChatMessage;
}

function normalizeTokenUsage(raw: unknown): DesktopThreadTokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const num = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const usage: DesktopThreadTokenUsage = {
    inputTokensTotal: num(obj.inputTokensTotal),
    outputTokensTotal: num(obj.outputTokensTotal),
    sessionTotal: num(obj.sessionTotal),
    modelCalls: num(obj.modelCalls),
    toolCalls: num(obj.toolCalls),
    turnCount: num(obj.turnCount),
    lastPromptTokens: num(obj.lastPromptTokens),
    lastResponseTokens: num(obj.lastResponseTokens),
    currentTurnTotal: num(obj.currentTurnTotal),
    contextWindow: num(obj.contextWindow),
  };
  if (typeof obj.durationMs === 'number' && obj.durationMs > 0) {
    usage.durationMs = obj.durationMs;
  }
  if (obj.contextBreakdown && typeof obj.contextBreakdown === 'object') {
    usage.contextBreakdown = obj.contextBreakdown;
  }
  // Drop empty summaries so old threads stay lean.
  if (
    usage.sessionTotal <= 0 &&
    usage.inputTokensTotal <= 0 &&
    usage.outputTokensTotal <= 0 &&
    usage.modelCalls <= 0 &&
    usage.toolCalls <= 0
  ) {
    return undefined;
  }
  return usage;
}

function normalizeThread(raw: unknown): DesktopChatThread | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const id = String(obj.id ?? '').trim();
  if (!id) return undefined;
  const tokenUsage = normalizeTokenUsage(obj.tokenUsage);
  return {
    id,
    title: String(obj.title ?? 'Chat').trim() || 'Chat',
    updatedAt:
      typeof obj.updatedAt === 'string'
        ? obj.updatedAt
        : new Date().toISOString(),
    messages: Array.isArray(obj.messages)
      ? obj.messages
          .map(normalizeMessage)
          .filter((m): m is DesktopChatMessage => Boolean(m))
      : [],
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(obj.pendingPlan != null ? { pendingPlan: obj.pendingPlan } : {}),
    ...(obj.pendingPlanStrategy != null
      ? { pendingPlanStrategy: obj.pendingPlanStrategy }
      : {}),
    ...(obj.pendingTaskList != null
      ? { pendingTaskList: obj.pendingTaskList }
      : {}),
  };
}

export function loadHistory(workspaceRoot: string): DesktopHistoryStore {
  const path = historyPath(workspaceRoot);
  if (!existsSync(path)) return empty();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    const threads = Array.isArray(raw.threads)
      ? raw.threads
          .map(normalizeThread)
          .filter((t): t is DesktopChatThread => Boolean(t))
      : [];
    const activeThreadId =
      typeof raw.activeThreadId === 'string' &&
      threads.some((t) => t.id === raw.activeThreadId)
        ? raw.activeThreadId
        : threads[0]?.id;
    return { threads, activeThreadId };
  } catch {
    return empty();
  }
}

export function saveHistory(
  workspaceRoot: string,
  store: DesktopHistoryStore,
): void {
  const dir = join(workspaceRoot, '.mitii');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    historyPath(workspaceRoot),
    `${JSON.stringify(store, null, 2)}\n`,
    'utf8',
  );
}

export function createThread(
  store: DesktopHistoryStore,
  title = 'New chat',
): DesktopHistoryStore {
  const id = `thread_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const thread: DesktopChatThread = {
    id,
    title,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  return {
    threads: [thread, ...store.threads].slice(0, 100),
    activeThreadId: id,
  };
}

export interface UpsertThreadOptions {
  title?: string;
  tokenUsage?: DesktopThreadTokenUsage;
  pendingPlan?: unknown | null;
  pendingPlanStrategy?: unknown | null;
  pendingTaskList?: unknown | null;
  clearPendingPlan?: boolean;
}

export function upsertThreadMessages(
  store: DesktopHistoryStore,
  threadId: string,
  messages: DesktopChatMessage[],
  titleOrOptions?: string | UpsertThreadOptions,
  tokenUsageArg?: DesktopThreadTokenUsage,
): DesktopHistoryStore {
  const options: UpsertThreadOptions =
    typeof titleOrOptions === 'string' || titleOrOptions === undefined
      ? {
          ...(titleOrOptions ? { title: titleOrOptions } : {}),
          ...(tokenUsageArg ? { tokenUsage: tokenUsageArg } : {}),
        }
      : titleOrOptions;

  const applyPending = (
    thread: DesktopChatThread,
  ): DesktopChatThread => {
    if (options.clearPendingPlan) {
      const {
        pendingPlan: _p,
        pendingPlanStrategy: _s,
        pendingTaskList: _t,
        ...rest
      } = thread;
      return rest;
    }
    const next: DesktopChatThread = { ...thread };
    if (options.pendingPlan !== undefined) {
      if (options.pendingPlan === null) delete next.pendingPlan;
      else next.pendingPlan = options.pendingPlan;
    }
    if (options.pendingPlanStrategy !== undefined) {
      if (options.pendingPlanStrategy === null) delete next.pendingPlanStrategy;
      else next.pendingPlanStrategy = options.pendingPlanStrategy;
    }
    if (options.pendingTaskList !== undefined) {
      if (options.pendingTaskList === null) delete next.pendingTaskList;
      else next.pendingTaskList = options.pendingTaskList;
    }
    return next;
  };

  const existing = store.threads.some((thread) => thread.id === threadId);
  if (!existing) {
    const base: DesktopChatThread = {
      id: threadId,
      title:
        options.title?.trim() ||
        messages.find((m) => m.role === 'user')?.text.slice(0, 60) ||
        'Chat',
      updatedAt: new Date().toISOString(),
      messages,
      ...(options.tokenUsage ? { tokenUsage: options.tokenUsage } : {}),
    };
    const created = applyPending(base);
    return {
      threads: [created, ...store.threads].slice(0, 100),
      activeThreadId: threadId,
    };
  }
  const threads = store.threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    const nextTitle =
      options.title?.trim() ||
      thread.title ||
      messages.find((m) => m.role === 'user')?.text.slice(0, 60) ||
      'Chat';
    const withMessages: DesktopChatThread = {
      ...thread,
      title: nextTitle,
      messages,
      updatedAt: new Date().toISOString(),
      ...(options.tokenUsage
        ? { tokenUsage: options.tokenUsage }
        : thread.tokenUsage
          ? { tokenUsage: thread.tokenUsage }
          : {}),
    };
    return applyPending(withMessages);
  });
  return { threads, activeThreadId: threadId };
}

/** Update only the token meter for a thread (keeps messages). */
export function upsertThreadTokenUsage(
  store: DesktopHistoryStore,
  threadId: string,
  tokenUsage: DesktopThreadTokenUsage,
): DesktopHistoryStore {
  const threads = store.threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    return {
      ...thread,
      tokenUsage,
      updatedAt: new Date().toISOString(),
    };
  });
  if (!threads.some((t) => t.id === threadId)) return store;
  return { ...store, threads };
}

export function deleteThread(
  store: DesktopHistoryStore,
  threadId: string,
): DesktopHistoryStore {
  const threads = store.threads.filter((t) => t.id !== threadId);
  const activeThreadId =
    store.activeThreadId === threadId ? threads[0]?.id : store.activeThreadId;
  return { threads, activeThreadId };
}
